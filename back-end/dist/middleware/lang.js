"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.langMiddleware = langMiddleware;
function langMiddleware(req, _res, next) {
    const header = (req.headers['accept-language'] || '').toString().toLowerCase();
    let selected = 'en';
    if (header.startsWith('fa'))
        selected = 'fa';
    // Attach selected language to request for downstream handlers
    req.lang = selected;
    next();
}
