import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, LogOut, Languages, ListTree, NotebookPen, FileText, Users as UsersGroup, Boxes, BarChart3, CalendarDays, Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { t, applyDir, i18n } from '../i18n';
import axios from 'axios';

/**
 * Navbar component for the accounting application.
 * - Logo navigates to Dashboard/root
 * - Language toggle and user menu on the right
 * - Middle nav includes icon+label links for main pages (excluding Dashboard)
 */
const Navbar: React.FC = () => {
  const { isAuthenticated, logout, user } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState<'fa' | 'en'>(
    (i18n.language as 'fa' | 'en') || 'fa'
  );
  const [isTreasuryOpen, setIsTreasuryOpen] = useState(false);
   const treasuryRef = useRef<HTMLDivElement>(null);
   // Basic Data submenu toggle state and element ref
   const [isBasicOpen, setIsBasicOpen] = useState(false);
   const basicRef = useRef<HTMLDivElement>(null);
   // Reports submenu toggle state and element ref
   const [isReportsOpen, setIsReportsOpen] = useState(false);
   const reportsRef = useRef<HTMLDivElement>(null);

   /**
    * Close dropdowns (Treasury and Basic Data) on outside click or Escape.
    * This prevents flicker and inconsistent close behavior.
    */
   /**
    * Dropdown close handlers: handles both Treasury and Basic Data menus.
    * - Closes when clicking outside respective dropdown containers.
    * - Closes on Escape key.
    */
   useEffect(() => {
     function onDocClick(e: MouseEvent | TouchEvent) {
       // Close Treasury when click outside its container
       if (treasuryRef.current && isTreasuryOpen && !treasuryRef.current.contains(e.target as Node)) {
         setIsTreasuryOpen(false);
       }
       // Close Basic Data when click outside its container
       if (basicRef.current && isBasicOpen && !basicRef.current.contains(e.target as Node)) {
         setIsBasicOpen(false);
       }
       // Close Reports when click outside its container
       if (reportsRef.current && isReportsOpen && !reportsRef.current.contains(e.target as Node)) {
         setIsReportsOpen(false);
       }
     }
     function onKey(e: KeyboardEvent) {
       if (e.key === 'Escape') {
         setIsTreasuryOpen(false);
         setIsBasicOpen(false);
         setIsReportsOpen(false);
       }
     }
     document.addEventListener('mousedown', onDocClick);
     document.addEventListener('touchstart', onDocClick);
     document.addEventListener('keydown', onKey);
     return () => {
       document.removeEventListener('mousedown', onDocClick);
       document.removeEventListener('touchstart', onDocClick);
       document.removeEventListener('keydown', onKey);
     };
   }, [isTreasuryOpen, isBasicOpen, isReportsOpen]);

  useEffect(() => {
    // Keep Accept-Language and document direction in sync with selected language
    axios.defaults.headers.common['Accept-Language'] = currentLanguage;
    applyDir(currentLanguage);
    document.documentElement.setAttribute('lang', currentLanguage);
    try { 
      localStorage.setItem('lang', currentLanguage); 
    } catch { /* noop */ }
  }, [currentLanguage]);

  /**
   * canViewHierarchicalReport
   * Checks user permissions to show the Hierarchical Codes report link.
   * فارسی: بررسی مجوز کاربر برای نمایش گزارش درختی.
   */
  function canViewHierarchicalReport(): boolean {
    const u = user;
    if (!u) return false;
    if (u.isAdmin) return true;
    const mod = u.permissions?.reports;
    if (mod === true) return true;
    if (mod && typeof mod === 'object') {
      return !!(mod as Record<string, boolean>)['hierarchical-codes'];
    }
    return false;
  }

  /**
   * Handle user logout and navigate to login page.
   */
  const handleLogout = () => { 
    logout(); 
    navigate('/login'); 
  };

  /**
   * Toggle between Farsi and English languages.
   */
  const toggleLanguage = () => {
    const newLang = currentLanguage === 'en' ? 'fa' : 'en';
    setCurrentLanguage(newLang);
  };

  /**
   * Main navigation items with icons (Dashboard excluded; accessible via logo click).
   * Labels are driven by i18n keys and will render in Farsi or English.
   */
  /**
   * Top-level navigation items remain concise; Basic Data is now a submenu.
   */
  const navItems: { to: string; labelKey: string; fallback: string; Icon: React.ComponentType<any> }[] = [
    { to: '/documents', labelKey: 'navigation.documents', fallback: 'Documents', Icon: FileText },
  ];

  return (
    <nav className="text-white shadow-md sticky top-0 z-50" style={{ backgroundColor: 'rgb(4, 131, 63)' }}>
      <div className="w-full px-0 relative z-10">
        <div className="flex items-center gap-x-3 h-28 w-full">
          {/* Left: logo (click navigates to Dashboard/root) */}
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center justify-center h-full">
              <Link to="/" aria-label={t('navigation.dashboard', 'Dashboard')} className="block rtl:mr-2 ltr:ml-2">
                <img 
                  src={currentLanguage === 'fa' ? '/green-bunch-logo.png' : '/green-bunch-logo1.png'} 
                  alt="Green Bunch Accounting" 
                  className="block max-w-[220px] max-h-[90px] w-auto h-auto" 
                  style={{ maxHeight: '90px', height: 'auto', width: 'auto' }}
                />
              </Link>
            </div>
          </div>

          {/* Middle: page navigation links (icon + label) */}
          <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-2 rtl:space-x-reverse text-white h-full ltr:ml-4 rtl:mr-4">
            {/* Basic Data dropdown trigger */}
            <div className="relative" ref={basicRef}>
              <button
                onClick={() => setIsBasicOpen((v) => !v)}
                className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 flex items-center bg-transparent"
                aria-label={t('navigation.basicData', 'Basic Data')}
                title={t('navigation.basicData', 'Basic Data')}
              >
                <ListTree className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                {t('navigation.basicData', 'Basic Data')}
              </button>
              {isBasicOpen && (
                <div className="absolute left-0 top-full mt-1 min-w-[200px] bg-[rgb(4,131,63)] shadow-md rounded-md py-2 z-50">
                  <Link
                    to="/codes"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsBasicOpen(false)}
                  >
                    {t('navigation.codes', 'Codes')}
                  </Link>
                  <Link
                    to="/details"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsBasicOpen(false)}
                  >
                    {t('navigation.details', 'Details')}
                  </Link>
                  <Link
                    to="/detail-levels"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsBasicOpen(false)}
                  >
                    {t('navigation.detailLevels', 'Detail Levels')}
                  </Link>
                  <Link
                    to="/fiscal-years"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsBasicOpen(false)}
                  >
                    {t('navigation.fiscalYears', 'Fiscal Years')}
                  </Link>
                </div>
              )}
            </div>

            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 flex items-center bg-transparent"
                 aria-label={t(item.labelKey, item.fallback)}
                 title={t(item.labelKey, item.fallback)}
               >
                 <item.Icon className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                 {t(item.labelKey, item.fallback)}
               </Link>
            ))}

            {/* Treasury dropdown trigger */}
            <div
              className="relative"
              ref={treasuryRef}
            >
              <button
                onClick={() => setIsTreasuryOpen((v) => !v)}
                className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 flex items-center bg-transparent"
                aria-label={t('navigation.treasury', 'Treasury')}
                title={t('navigation.treasury', 'Treasury')}
              >
                <Wallet className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                {t('navigation.treasury', 'Treasury')}
              </button>
              {isTreasuryOpen && (
                <div className="absolute left-0 top-full mt-1 min-w-[200px] bg-[rgb(4,131,63)] shadow-md rounded-md py-2 z-50">
                   <Link
                     to="/treasury/cashboxes"
                     className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                     onClick={() => setIsTreasuryOpen(false)}
                   >
                     {t('navigation.treasuryCashboxes', 'Cashboxes')}
                   </Link>
                   {/* Consolidated Manage Banks: removed standalone Banks link */}
                   <Link
                      to="/treasury/bank-accounts"
                      className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                      onClick={() => setIsTreasuryOpen(false)}
                    >
                      {t('navigation.treasuryManageBanks', 'Manage Banks')}
                    </Link>
                    <Link
                      to="/treasury/checks"
                      className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                      onClick={() => setIsTreasuryOpen(false)}
                    >
                      {t('navigation.treasuryChecks', 'Manage Check')}
                    </Link>
                   <Link
                     to="/treasury/receipts"
                     className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                     onClick={() => setIsTreasuryOpen(false)}
                   >
                     {t('navigation.treasuryReceipts', 'Receipts')}
                   </Link>
                   <Link
                     to="/treasury/payments"
                     className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                     onClick={() => setIsTreasuryOpen(false)}
                   >
                     {t('navigation.treasuryPayments', 'Payments')}
                   </Link>
                   <Link
                     to="/treasury/settings"
                     className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                     onClick={() => setIsTreasuryOpen(false)}
                   >
                     {t('navigation.treasurySettings', 'Settings')}
                   </Link>
                 </div>
              )}
            </div>

            {/* Reports dropdown trigger */}
            <div className="relative" ref={reportsRef}>
              <button
                onClick={() => setIsReportsOpen((v) => !v)}
                className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 flex items-center bg-transparent"
                aria-label={t('navigation.reports', 'Reports')}
                title={t('navigation.reports', 'Reports')}
              >
                <BarChart3 className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                {t('navigation.reports', 'Reports')}
              </button>
              {isReportsOpen && (
                <div className="absolute left-0 top-full mt-1 min-w-[240px] bg-[rgb(4,131,63)] shadow-md rounded-md py-2 z-50">
                  <Link
                    to="/reports/accounts-review"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsReportsOpen(false)}
                  >
                    {t('navigation.accountsReviewReport', 'Accounts Review Report')}
                  </Link>
                  <Link
                    to="/reports/hierarchical-codes"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsReportsOpen(false)}
                  >
                    {t('navigation.balanceReport', currentLanguage === 'fa' ? 'گزارش تراز' : 'Balance Report')}
                  </Link>
                  <Link
                    to="/reports/journal-builder"
                    className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2"
                    onClick={() => setIsReportsOpen(false)}
                  >
                    {t('navigation.journalReportBuilder', currentLanguage === 'fa' ? 'گزارش دفاتر' : 'Notebook Reports')}
                  </Link>
                </div>
              )}
            </div>

          </div>

          {/* Right: language toggle + profile/logout or login */}
          <div className="flex items-center space-x-3 rtl:space-x-reverse h-full ltr:ml-auto rtl:mr-auto rtl:ml-0">
            {isAuthenticated ? (
              <>
                <motion.button 
                  onClick={toggleLanguage} 
                  className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                   // style={{ color: '#fff', backgroundColor: 'transparent', lineHeight: '1.5', fontSize: '14px', height: '40px', border: 'none', outline: 'none' }}
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.98 }}
                >
                  <Languages className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {currentLanguage === 'en' ? 'فارسی' : 'English'}
                </motion.button>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link 
                    to="/profile" 
                    className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                    // style={{ marginLeft:'10px', color: '#fff', textDecoration: 'none', backgroundColor: 'transparent' }}
                  >
                    <User className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                    {}
                  </Link>
                </motion.div>
                <motion.button 
                  onClick={handleLogout} 
                  className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                  // style={{ color: '#fff', backgroundColor: 'transparent' }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <LogOut className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {}
                </motion.button>
              </>
            ) : (
              <>
                <motion.button 
                  onClick={toggleLanguage} 
                  className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                   // style={{ marginLeft: '10px', color: '#fff', backgroundColor: 'transparent', lineHeight: '1.5', fontSize: '14px', height: '40px', border: 'none', outline: 'none' }}
                   whileHover={{ scale: 1.05 }}
                   whileTap={{ scale: 0.98 }}
                >
                  <Languages className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {currentLanguage === 'en' ? 'فارسی' : 'English'}
                </motion.button>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link
                    to="/login"
                    className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 bg-transparent"
                    // style={{ color: '#fff', textDecoration: 'none', backgroundColor: 'transparent' }}
                  >
                    {}
                  </Link>
                </motion.div>
              </>
            )}
          </div>

          {/* Mobile menu button (disabled on desktop and mobile to always show desktop nav) */}
          <div className="hidden"></div>
        </div>
      </div>

      {/* Mobile Navigation with icons */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-28 left-0 right-0 shadow-lg bg-[rgb(4,131,63)]">
          <div className="px-2 pt-2 pb-3 space-y-1">
            <button 
              onClick={toggleLanguage} 
              className="w-full text-left text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent leading-6 text-sm min-h-[40px] border-0 outline-none"
            >
              <Languages className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
              {currentLanguage === 'en' ? 'فارسی' : 'English'}
            </button>

            {/* Basic Data mobile submenu */}
            <div className="px-3 py-2 text-white font-medium">
              {t('navigation.basicData', 'Basic Data')}
            </div>
            <Link 
              to="/codes"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.codes', 'Codes')}
            </Link>
            <Link 
              to="/details"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.details', 'Details')}
            </Link>
            <Link 
              to="/detail-levels"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.detailLevels', 'Detail Levels')}
            </Link>
            <Link 
              to="/fiscal-years"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.fiscalYears', 'Fiscal Years')}
            </Link>

            {/* Mobile: page navigation links with icons */}
            {navItems.map((item) => (
              <Link 
                key={item.to}
                to={item.to}
                className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span className="flex items-center">
                  <item.Icon className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {t(item.labelKey, item.fallback)}
                </span>
              </Link>
            ))}

            {/* Treasury mobile submenu */}
            <Link 
              to="/treasury/cashboxes"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.treasuryCashboxes', 'Cashboxes')}
            </Link>
            <Link 
              to="/treasury/bank-accounts"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.treasuryManageBanks', 'Manage Banks')}
            </Link>
            <Link 
              to="/treasury/receipts"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.treasuryReceipts', 'Receipts')}
            </Link>
            <Link 
              to="/treasury/payments"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.treasuryPayments', 'Payments')}
            </Link>

            {/* Reports mobile submenu */}
            <div className="px-3 py-2 text-white font-medium">
              {t('navigation.reports', 'Reports')}
            </div>
            <Link 
              to="/reports/accounts-review"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.accountsReviewReport', 'Accounts Review Report')}
            </Link>
            <Link 
              to="/reports/hierarchical-codes"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.balanceReport', currentLanguage === 'fa' ? 'گزارش تراز' : 'Balance Report')}
            </Link>
            <Link 
              to="/reports/journal-builder"
              className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
              onClick={() => setIsMobileMenuOpen(false)}
            >
              {t('navigation.journalReportBuilder', currentLanguage === 'fa' ? 'گزارش دفاتر' : 'Notebook Reports')}
            </Link>

            {isAuthenticated ? (
              <>
                <Link 
                  to="/profile" 
                  className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent" 
                  // style={{ color: '#fff', textDecoration: 'none', backgroundColor: 'transparent' }}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('navigation.profile', 'Profile')}
                </Link>
                <button 
                  onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }} 
                  className="w-full text-left text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                  // style={{ color: '#fff', backgroundColor: 'transparent' }}
                >
                  <LogOut className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {}
                </button>
              </>
            ) : (
              <Link 
                to="/login" 
                className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent leading-6 text-sm h-10 border-0 outline-none" 
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {}
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

/**
 * TreasuryDropdown component is defined inline so it can leverage
 * local i18n and routing. Declared after Navbar and hoisted.
 */
function TreasuryDropdown() {
  return null; // Not used since we embedded the dropdown directly in JSX above.
}

export default Navbar;
