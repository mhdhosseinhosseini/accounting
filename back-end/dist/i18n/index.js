"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.t = t;
const dict = {
    en: {
        'health.ok': 'Accounting service is healthy',
        'fiscalYears.list': 'Fiscal years fetched',
        'journal.created': 'Journal draft created',
        'journal.posted': 'Journal posted successfully',
        'error.unbalanced': 'Journal is not balanced',
    },
    fa: {
        'health.ok': 'سرویس حسابداری سالم است',
        'fiscalYears.list': 'سال‌های مالی بازیابی شد',
        'journal.created': 'سند پیش‌نویس ایجاد شد',
        'journal.posted': 'سند با موفقیت پست شد',
        'error.unbalanced': 'سند حسابداری بالانس نیست',
    },
};
/**
 * Translate a message key to the selected language.
 */
function t(key, lang = 'en') {
    const selected = dict[lang] || dict.en;
    return selected[key] || key;
}
