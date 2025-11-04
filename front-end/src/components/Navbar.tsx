import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, LogOut, Languages, Menu, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { t, applyDir, i18n } from '../i18n';
import axios from 'axios';

/**
 * Navbar component for the accounting application.
 * Simplified version of the admin navbar with only logo, language toggle, and user menu.
 * Removes all middle navigation menus and dashboard link as requested.
 */
const Navbar: React.FC = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState<'fa' | 'en'>(
    (i18n.language as 'fa' | 'en') || 'fa'
  );

  useEffect(() => {
    // Keep Accept-Language and document direction in sync with selected language
    axios.defaults.headers.common['Accept-Language'] = currentLanguage;
    applyDir(currentLanguage);
    document.documentElement.setAttribute('lang', currentLanguage);
    try { 
      localStorage.setItem('lang', currentLanguage); 
    } catch {}
  }, [currentLanguage]);

  /**
   * Handle user logout
   */
  const handleLogout = () => { 
    logout(); 
    navigate('/login'); 
  };

  /**
   * Toggle between Farsi and English languages
   */
  const toggleLanguage = () => {
    const newLang = currentLanguage === 'en' ? 'fa' : 'en';
    setCurrentLanguage(newLang);
  };

  return (
    <nav className="text-white shadow-md sticky top-0 z-50" style={{ backgroundColor: 'rgb(4, 131, 63)', paddingInline: '32px', color: '#fff !important', height: '112px', minHeight: '112px', maxHeight: '112px' }}>
      <div className="max-w-7xl mx-auto px-6 md:px-10 lg:px-12 xl:px-16 relative z-10" style={{ height: '100%' }}>
        <div className="flex justify-between items-center" style={{ height: '100%', minHeight: '112px' }}>
          {/* Left: logo only (no middle navigation menus) */}
          <div className="flex items-center" style={{ height: '100%' }}>
            <div className="flex items-center justify-center" style={{ height: '100%' }}>
              <img 
                src={currentLanguage === 'fa' ? '/green-bunch-logo.png' : '/green-bunch-logo1.png'} 
                alt="Green Bunch Accounting" 
                className="block max-w-[220px] max-h-[90px] w-auto h-auto" 
                style={{ maxHeight: '90px', height: 'auto', width: 'auto' }}
              />
            </div>
          </div>

          {/* Right: language toggle + profile/logout or login */}
          <div className="flex items-center space-x-4 rtl:space-x-reverse" style={{ height: '100%' }}>
            {isAuthenticated ? (
              <>
                <motion.button 
                  onClick={toggleLanguage} 
                  className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                  style={{ color: '#fff !important', backgroundColor: 'transparent', lineHeight: '1.5', fontSize: '14px', height: '40px', border: 'none', outline: 'none' }}
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
                    style={{ color: '#fff !important', textDecoration: 'none !important', backgroundColor: 'transparent' }}
                  >
                    <User className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                    {t('navigation.profile', 'Profile')}
                  </Link>
                </motion.div>
                <motion.button 
                  onClick={handleLogout} 
                  className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                  style={{ color: '#fff !important', backgroundColor: 'transparent' }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <LogOut className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {t('navigation.logout', 'Logout')}
                </motion.button>
              </>
            ) : (
              <>
                <motion.button 
                  onClick={toggleLanguage} 
                  className="text-white hover:text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                  style={{ color: '#fff !important', backgroundColor: 'transparent', lineHeight: '1.5', fontSize: '14px', height: '40px', border: 'none', outline: 'none' }}
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
                    style={{ color: '#fff !important', textDecoration: 'none !important', backgroundColor: 'transparent' }}
                  >
                    {t('navigation.login', 'Login')}
                  </Link>
                </motion.div>
              </>
            )}
          </div>

          {/* Mobile menu button (disabled on desktop and mobile to always show desktop nav) */}
          <div className="hidden"></div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-28 left-0 right-0 shadow-lg" style={{ backgroundColor: 'rgb(4, 131, 63)' }}>
          <div className="px-2 pt-2 pb-3 space-y-1">
            <button 
              onClick={toggleLanguage} 
              className="w-full text-left text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
              style={{ color: '#fff !important', backgroundColor: 'transparent', lineHeight: '1.5', fontSize: '14px', minHeight: '40px', border: 'none', outline: 'none' }}
            >
              <Languages className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
              {currentLanguage === 'en' ? 'فارسی' : 'English'}
            </button>

            {isAuthenticated ? (
              <>
                <Link 
                  to="/profile" 
                  className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent" 
                  style={{ color: '#fff !important', textDecoration: 'none !important', backgroundColor: 'transparent' }}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {t('navigation.profile', 'Profile')}
                </Link>
                <button 
                  onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }} 
                  className="w-full text-left text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium flex items-center transition-colors duration-200 bg-transparent"
                  style={{ color: '#fff !important', backgroundColor: 'transparent' }}
                >
                  <LogOut className="h-5 w-5 mr-2 rtl:ml-2 rtl:mr-0" />
                  {t('navigation.logout', 'Logout')}
                </button>
              </>
            ) : (
              <Link 
                to="/login" 
                className="block text-white hover:bg-green-700 hover:bg-opacity-50 px-3 py-2 rounded-md font-medium transition-colors duration-200 bg-transparent" 
                style={{ color: '#fff !important', textDecoration: 'none !important', backgroundColor: 'transparent' }}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {t('navigation.login', 'Login')}
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;