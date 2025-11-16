/**
 * LoginPage replicating admin OTP login flow and theme.
 * - Renders green header bar with logo and language toggle.
 * - Step 1: enter mobile number, request OTP.
 * - Step 2: enter 6-digit code, verify OTP, store token/user.
 */
import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import config from '../config';
import { i18n } from '../i18n';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';
import Navbar from '../components/Navbar';

// Utility: Validate Iranian mobile numbers (starts with 09 and 11 digits total)
function isValidMobile(mobile: string) {
  return /^09\d{9}$/.test(mobile);
}

const CODE_LENGTH = 6;

export const LoginPage: React.FC = () => {
  const { loginWithTokenAndUser } = useAuth();
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [step, setStep] = useState<'mobile' | 'code'>('mobile');
  const [mobileNumber, setMobileNumber] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeDigits, setCodeDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const [resendCooldown, setResendCooldown] = useState(0);
  const devAutoLogin = String(import.meta.env.VITE_DEV_AUTO_LOGIN || '').toLowerCase() === 'true';

  // Keep Accept-Language aligned with current language from i18next
  useEffect(() => {
    const handleLanguageChange = (lang: string) => {
      axios.defaults.headers.common['Accept-Language'] = lang;
    };
    i18n.on('languageChanged', handleLanguageChange);
    handleLanguageChange(i18n.language); // Set initial value
    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, []);

  // Start a simple 60s timer after requesting OTP
  useEffect(() => {
    if (step === 'code') {
      setResendCooldown(60);
      const id = window.setInterval(() => {
        setResendCooldown(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => {
        clearInterval(id);
      };
    }
  }, [step]);

  /**
   * Handle requesting OTP via backend.
   */
  async function requestOtp() {
    setError('');
    if (!isValidMobile(mobileNumber)) {
      setError(t('auth.invalid_mobile', 'Invalid mobile number'));
      return;
    }
    try {
      setLoading(true);
      await axios.post(`${config.API_ENDPOINTS.base}/auth/request-otp`, { mobileNumber });
      setStep('code');
      setCodeDigits(Array(CODE_LENGTH).fill(''));
      // Focus first code box
      setTimeout(() => inputsRef.current[0]?.focus(), 100);
    } catch (e) {
      let message = t('auth.request_failed', 'Failed to send OTP');
      if (axios.isAxiosError<{ message: string }>(e) && e.response?.data?.message) {
        message = e.response.data.message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Verify typed OTP against backend; on success, store token/user.
   */
  async function verifyOtp() {
    setError('');
    const code = codeDigits.join('');
    if (code.length !== CODE_LENGTH) {
      setError(t('auth.invalid_code', 'Invalid verification code'));
      return;
    }
    try {
      setLoading(true);
      const res = await axios.post(`${config.API_ENDPOINTS.base}/auth/verify-otp`, { mobileNumber, otp: code });
      const { token, user } = res.data;
      await loginWithTokenAndUser(token, user);
    } catch (e) {
      let message = t('auth.verify_failed', 'Failed to verify OTP');
      if (axios.isAxiosError<{ message: string }>(e) && e.response?.data?.message) {
        message = e.response.data.message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handle typing in a single code input.
   */
  function onCodeChange(idx: number, value: string) {
    const v = value.replace(/\D/g, '').slice(0, 1);
    const next = [...codeDigits];
    next[idx] = v;
    setCodeDigits(next);
    if (v && idx < CODE_LENGTH - 1) inputsRef.current[idx + 1]?.focus();
  }

  /**
   * Handle paste of code (e.g., from SMS).
   */
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('Text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!text) return;
    e.preventDefault();
    const arr = text.split('');
    const next = Array(CODE_LENGTH).fill('');
    arr.forEach((d, i) => (next[i] = d));
    setCodeDigits(next);
    // Focus last filled or verify
    const last = arr.length - 1;
    if (last >= 0 && last < CODE_LENGTH) inputsRef.current[last]?.focus();
  }

  /**
   * Handle backspace navigation.
   */
  function onKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !codeDigits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 login-page">
      <Navbar />

      <div className="w-full flex items-center justify-center py-10">
        <div className="w-full max-w-md bg-white shadow-md rounded-xl p-6">
          <div className="mb-4 flex items-center gap-2 justify-center">
            <h1 className="text-xl font-semibold text-gray-900">{t('auth.title', 'Login')}</h1>
          </div>

          {devAutoLogin && (
            <div className="mb-4 rounded-md bg-yellow-100 text-yellow-800 p-3">
              <div className="font-semibold mb-1">Development Mode</div>
              <p className="text-sm">Auto-login is enabled. You will be automatically logged in.</p>
            </div>
          )}

          {step === 'mobile' && (
            <div>
              <label className="block text-sm text-gray-700 mb-2">{t('auth.enter_mobile', 'Enter your mobile number')}</label>
              <input
                value={mobileNumber}
                onChange={e => setMobileNumber(e.target.value)}
                placeholder={t('auth.mobile_placeholder', '09xxxxxxxxx')}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--gb-primary-main)]"
                inputMode="numeric"
                dir="ltr"
              />

              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

              <button
                onClick={requestOtp}
                disabled={loading}
                className={`mt-6 w-full rounded-lg font-medium text-white transition-colors duration-200 text-base py-3 px-4 bg-[var(--gb-button-primary-bg)] hover:bg-[var(--gb-button-primary-hover)] ${
                  loading 
                    ? 'opacity-50 cursor-not-allowed' 
                    : ''
                }`}
              >
                {loading ? t('auth.sending', 'Sending...') : t('auth.send_code', 'Send Code')}
              </button>
            </div>
          )}

          {step === 'code' && (
            <div>
              <p className="text-sm text-gray-600 mb-2">{t('auth.code_sent', `Code sent to ${mobileNumber}`)}</p>
              <div className="flex justify-center gap-2" dir="ltr">
                {codeDigits.map((d, i) => (
                  <input
                      key={i}
                      ref={el => { inputsRef.current[i] = el; }}
                      value={d}
                      onChange={e => onCodeChange(i, e.target.value)}
                      onKeyDown={e => onKeyDown(i, e)}
                      onPaste={onPaste}
                      inputMode="numeric"
                      maxLength={1}
                      className="w-10 h-12 border border-gray-300 rounded-lg text-center text-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--gb-primary-main)]"
                    />
                ))}
              </div>

              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

              <button
                onClick={verifyOtp}
                disabled={loading}
                className={`w-full font-medium rounded-lg transition-all duration-200 text-white py-3 px-4 bg-[var(--gb-button-primary-bg)] hover:bg-[var(--gb-button-primary-hover)] ${
                  loading 
                    ? 'opacity-50 cursor-not-allowed' 
                    : ''
                }`}
              >
                {loading ? t('auth.verifying', 'Verifying...') : t('auth.verify', 'Verify')}
              </button>

              <div className="mt-3 flex justify-between text-sm">
                <button
                  className="transition-colors duration-200 text-[var(--gb-primary-main)] hover:text-[var(--gb-primary-dark)]"
                  onClick={() => setStep('mobile')}
                >
                  {t('auth.change_number', 'Change Number')}
                </button>
                <button
                  onClick={requestOtp}
                  disabled={resendCooldown > 0}
                  className={`transition-colors duration-200 ${resendCooldown > 0 ? 'opacity-50 text-gray-400 cursor-not-allowed' : 'text-[var(--gb-primary-main)] hover:text-[var(--gb-primary-dark)]'}`}
                >
                  {resendCooldown > 0 ? t('auth.resend_in', `Resend in ${resendCooldown}s`) : t('auth.resend', 'Resend')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};