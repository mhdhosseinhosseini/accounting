"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.smsService = exports.SMSService = void 0;
/**
 * SMSService for Accounting backend.
 * Mirrors the server project's Magfa integration with safe fallbacks.
 * - If Magfa env vars exist, sends via Magfa HTTP API using native fetch.
 * - Otherwise logs the SMS content for development/testing.
 * - Formats Iranian numbers (09xxxxxxxxx -> 989xxxxxxxxx) for Magfa.
 */
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class SMSService {
    constructor() {
        this.baseURL = process.env.MAGFA_SMS_BASE_URL || 'https://sms.magfa.com/api/http/sms/v2/send';
        this.username = process.env.MAGFA_USERNAME;
        this.password = process.env.MAGFA_PASSWORD;
        this.domain = process.env.MAGFA_DOMAIN;
        this.devForceDebug = String(process.env.DEV_FORCE_DEBUG_OTP || '').toLowerCase() === 'true';
    }
    /**
     * Format a local Iranian mobile (e.g., 09xxxxxxxxx) to Magfa format 989xxxxxxxxx.
     */
    formatIranMobile(mobile) {
        let formatted = mobile.replace(/[^0-9]/g, '');
        if (formatted.startsWith('0')) {
            formatted = '98' + formatted.slice(1);
        }
        return formatted;
    }
    /**
     * Send a generic SMS message.
     * Behavior:
     * - When DEV_FORCE_DEBUG_OTP=true, bypass Magfa entirely and log the SMS.
     * - When Magfa credentials are missing, log and return success in development.
     * - Otherwise, attempt to send via Magfa HTTP API.
     */
    async sendSMS(recipient, message) {
        const formattedRecipient = this.formatIranMobile(recipient);
        // Bypass SMS sending entirely when DEV_FORCE_DEBUG_OTP=true
        if (this.devForceDebug) {
            console.log('[DEV SMS] (forced debug) To:', formattedRecipient, '\nMessage:', message);
            return { success: true, message: 'SMS bypassed (DEV_FORCE_DEBUG_OTP=true)' };
        }
        // If Magfa credentials are not set, log and return success in dev.
        if (!this.username || !this.password || !this.domain) {
            console.log('[DEV SMS] To:', formattedRecipient, '\nMessage:', message);
            return { success: true, message: 'SMS logged (development mode)' };
        }
        try {
            const authUser = `${this.username}/magfa`;
            const authHeader = Buffer.from(`${authUser}:${this.password}`).toString('base64');
            const resp = await fetch(this.baseURL, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Basic ${authHeader}`,
                },
                body: JSON.stringify({
                    senders: [this.domain],
                    messages: [message],
                    recipients: [formattedRecipient],
                }),
            });
            const data = await resp.json().catch(() => null);
            console.log('[Magfa API Response]', data);
            if (resp.ok && data && data.status === 0) {
                const msg0 = data.messages && data.messages.length > 0 ? data.messages[0] : null;
                if (msg0 && msg0.status === 0) {
                    return { success: true, message: 'SMS queued successfully', messageId: msg0.messageId };
                }
                const messageStatus = msg0 ? msg0.status : 'N/A';
                const messageError = msg0 ? msg0.message : 'N/A';
                return { success: false, error: `Magfa message status not 0. Status: ${messageStatus}, Error: ${messageError}` };
            }
            return { success: false, error: (data && data.message) || 'Failed to send SMS' };
        }
        catch (err) {
            console.error('SMS sending error:', err?.message || err);
            return { success: false, error: err?.message || 'Unknown SMS error' };
        }
    }
    /**
     * Send an OTP message in Persian with validity notice.
     */
    async sendOtp(mobileNumber, otp) {
        const message = `کد تایید شما در گرین بانچ: ${otp}\nاین کد تا ۲ دقیقه دیگر معتبر است.`;
        console.log(`[SMS] Sending OTP to ${mobileNumber} with code: ${otp}`);
        return this.sendSMS(mobileNumber, message);
    }
}
exports.SMSService = SMSService;
exports.smsService = new SMSService();
