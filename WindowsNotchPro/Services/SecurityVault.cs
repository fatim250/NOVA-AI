using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WindowsNotchPro.Services;

public sealed class SecurityVault
{
    public const int Pbkdf2Iterations = 200_000;
    public const int MaxFailedAttempts = 3;
    public const double DefaultVoiceThreshold = 0.82;

    private readonly AuditLogger _audit;
    private readonly string _vaultFilePath;
    private readonly object _lock = new();

    private VaultRecord _record;
    private int _failedAttempts;
    private DateTimeOffset? _lockoutUntil;

    private sealed class VaultRecord
    {
        public string SaltBase64 { get; set; } = string.Empty;
        public string HashBase64 { get; set; } = string.Empty;
        public double[] EnrolledVoiceprint { get; set; } = Array.Empty<double>();
        public double VoiceThreshold { get; set; } = DefaultVoiceThreshold;
    }

    public SecurityVault(AuditLogger audit)
    {
        _audit = audit;
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "WindowsNotchPro");
        Directory.CreateDirectory(dir);
        _vaultFilePath = Path.Combine(dir, "vault.bin");
        _record = LoadOrInitialize();
    }

    public bool IsEnrolled => !string.IsNullOrEmpty(_record.HashBase64) && _record.EnrolledVoiceprint.Length > 0;

    public int LockoutSecondsRemaining
    {
        get
        {
            lock (_lock)
            {
                if (_lockoutUntil is null || _lockoutUntil <= DateTimeOffset.UtcNow) return 0;
                return (int)Math.Ceiling((_lockoutUntil.Value - DateTimeOffset.UtcNow).TotalSeconds);
            }
        }
    }

    public void EnrollCredentials(string passphrase, double[] voiceprintVector)
    {
        if (string.IsNullOrWhiteSpace(passphrase) || passphrase.Length < 8)
        {
            throw new ArgumentException("Passphrase must be at least 8 characters.");
        }
        if (voiceprintVector is null || voiceprintVector.Length < 8)
        {
            throw new ArgumentException("Voiceprint feature vector must contain at least 8 MFCC dimensions.");
        }

        lock (_lock)
        {
            var salt = RandomNumberGenerator.GetBytes(32);
            var hash = DerivePbkdf2(passphrase, salt);

            _record = new VaultRecord
            {
                SaltBase64 = Convert.ToBase64String(salt),
                HashBase64 = Convert.ToBase64String(hash),
                EnrolledVoiceprint = (double[])voiceprintVector.Clone(),
                VoiceThreshold = DefaultVoiceThreshold,
            };

            SaveSealedRecord(_record);
            _failedAttempts = 0;
            _lockoutUntil = null;
            _audit.Log("security", "vault_enrolled", "allowed", $"PBKDF2-HMAC-SHA256 ({Pbkdf2Iterations} rounds) + voiceprint sealed via DPAPI");
        }
    }

    public (bool Verified, double Similarity, string Message) VerifyTwoFactor(string passphrase, double[] candidateVoiceprint)
    {
        lock (_lock)
        {
            if (_lockoutUntil.HasValue && _lockoutUntil.Value > DateTimeOffset.UtcNow)
            {
                var remaining = (int)Math.Ceiling((_lockoutUntil.Value - DateTimeOffset.UtcNow).TotalSeconds);
                var lockMsg = $"Brute-force lockout active. Retry in {remaining}s.";
                _audit.Log("security", "unlock_rate_limited", "blocked", lockMsg);
                return (false, 0.0, lockMsg);
            }

            if (!IsEnrolled)
            {
                return (false, 0.0, "Security Vault is not enrolled yet. Configure passphrase and voiceprint first.");
            }

            var salt = Convert.FromBase64String(_record.SaltBase64);
            var expectedHash = Convert.FromBase64String(_record.HashBase64);
            var candidateHash = DerivePbkdf2(passphrase ?? string.Empty, salt);

            bool passphraseOk = CryptographicOperations.FixedTimeEquals(expectedHash, candidateHash);
            CryptographicOperations.ZeroMemory(candidateHash);

            double similarity = ComputeCosineSimilarity(_record.EnrolledVoiceprint, candidateVoiceprint);
            bool voiceOk = similarity >= _record.VoiceThreshold;

            if (passphraseOk && voiceOk)
            {
                _failedAttempts = 0;
                _lockoutUntil = null;
                _audit.Log("security", "2fa_verified", "allowed", $"2FA verified (cosine similarity {similarity:F2})");
                return (true, similarity, "2FA passphrase and voiceprint verified.");
            }

            _failedAttempts++;
            if (_failedAttempts >= MaxFailedAttempts)
            {
                _lockoutUntil = DateTimeOffset.UtcNow.AddSeconds(60);
                _failedAttempts = 0;
                const string lockoutMsg = "3 failed 2FA attempts detected. Locked for 60 seconds.";
                _audit.Log("security", "2fa_lockout_triggered", "blocked", lockoutMsg);
                return (false, similarity, lockoutMsg);
            }

            var reason = !passphraseOk
                ? "Passphrase mismatch."
                : $"Voiceprint similarity {similarity:F2} below threshold {_record.VoiceThreshold:F2}.";

            _audit.Log("security", "2fa_failed", "blocked", $"{reason} (attempt {_failedAttempts}/{MaxFailedAttempts})");
            return (false, similarity, $"{reason} Attempt {_failedAttempts} of {MaxFailedAttempts}.");
        }
    }

    private static byte[] DerivePbkdf2(string passphrase, byte[] salt)
    {
        var passBytes = Encoding.UTF8.GetBytes(passphrase);
        try
        {
            return Rfc2898DeriveBytes.Pbkdf2(passBytes, salt, Pbkdf2Iterations, HashAlgorithmName.SHA256, 32);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(passBytes);
        }
    }

    public static double ComputeCosineSimilarity(double[] a, double[] b)
    {
        if (a is null || b is null || a.Length == 0 || a.Length != b.Length) return 0.0;
        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        double denom = Math.Sqrt(normA) * Math.Sqrt(normB);
        return denom > 1e-9 ? dot / denom : 0.0;
    }

    private VaultRecord LoadOrInitialize()
    {
        if (File.Exists(_vaultFilePath))
        {
            try
            {
                var sealedBytes = File.ReadAllBytes(_vaultFilePath);
                var plainBytes = NativeInterop.UnprotectBytes(sealedBytes);
                try
                {
                    var loaded = JsonSerializer.Deserialize<VaultRecord>(plainBytes);
                    if (loaded is not null) return loaded;
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(plainBytes);
                }
            }
            catch (Exception ex)
            {
                _audit.Log("security", "vault_load_warning", "warning", ex.Message);
            }
        }

        // Optional environment-driven bootstrap (never hardcode literal passphrases in source)
        var envPass = Environment.GetEnvironmentVariable("NOTCH_VAULT_PASSPHRASE");
        if (!string.IsNullOrWhiteSpace(envPass) && envPass.Length >= 8)
        {
            var bootstrap = new VaultRecord();
            var salt = RandomNumberGenerator.GetBytes(32);
            bootstrap.SaltBase64 = Convert.ToBase64String(salt);
            bootstrap.HashBase64 = Convert.ToBase64String(DerivePbkdf2(envPass, salt));
            bootstrap.EnrolledVoiceprint = new[] { 0.42, 0.31, 0.58, 0.27, 0.64, 0.39, 0.52, 0.44 };
            return bootstrap;
        }

        return new VaultRecord();
    }

    private void SaveSealedRecord(VaultRecord record)
    {
        var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(record);
        try
        {
            var sealedBytes = NativeInterop.ProtectBytes(jsonBytes);
            File.WriteAllBytes(_vaultFilePath, sealedBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(jsonBytes);
        }
    }
}
