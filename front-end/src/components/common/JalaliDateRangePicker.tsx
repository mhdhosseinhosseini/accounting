import React, { useState, useEffect, useRef } from 'react';
import DatePicker, { DateObject } from 'react-multi-date-picker';
import TimePicker from 'react-multi-date-picker/plugins/time_picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import 'react-multi-date-picker/styles/layouts/mobile.css';
import 'react-multi-date-picker/styles/colors/teal.css';
import 'react-multi-date-picker/styles/layouts/prime.css';

interface JalaliDateRangePickerProps {
  fromDate: Date | null;
  toDate: Date | null;
  onFromDateChange: (date: Date | null) => void;
  onToDateChange: (date: Date | null) => void;
  onApply: () => void;
  includeTime?: boolean;
}

/**
 * JalaliDateRangePicker
 * A controlled Jalali (Persian) date range picker component.
 * - Displays a clickable trigger with the selected from/to dates in RTL.
 * - Opens an overlay dialog with two DatePicker widgets for start and end dates.
 * - Converts internal DateObject values to JavaScript Date and calls parent callbacks.
 * - Optionally includes a time picker via `includeTime`.
 */
const JalaliDateRangePicker: React.FC<JalaliDateRangePickerProps> = ({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onApply,
  includeTime = false,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [fromDateValue, setFromDateValue] = useState<DateObject | null>(null);
  const [toDateValue, setToDateValue] = useState<DateObject | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const fromDatePickerRef = useRef<any>(null);
  const toDatePickerRef = useRef<any>(null);

  // Sync incoming Date props to DateObject for the picker controls
  useEffect(() => {
    if (fromDate) {
      setFromDateValue(
        new DateObject({
          date: fromDate,
          calendar: persian,
          locale: persian_fa,
        })
      );
    } else {
      setFromDateValue(null);
    }

    if (toDate) {
      setToDateValue(
        new DateObject({
          date: toDate,
          calendar: persian,
          locale: persian_fa,
        })
      );
    } else {
      setToDateValue(null);
    }
  }, [fromDate, toDate]);

  // Close the dialog when clicking outside of it or the trigger
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Ensure the calendars remain open while the dialog is visible
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (fromDatePickerRef.current) {
          fromDatePickerRef.current.openCalendar();
        }
        if (toDatePickerRef.current) {
          toDatePickerRef.current.openCalendar();
        }
      }, 100);

      const keepOpenInterval = setInterval(() => {
        if (fromDatePickerRef.current && !fromDatePickerRef.current.isOpen) {
          fromDatePickerRef.current.openCalendar();
        }
        if (toDatePickerRef.current && !toDatePickerRef.current.isOpen) {
          toDatePickerRef.current.openCalendar();
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        clearInterval(keepOpenInterval);
      };
    }
  }, [isOpen]);

  // Handle start-date changes: update internal state and notify parent
  const handleFromDateChange = (date: DateObject) => {
    setFromDateValue(date);
    const jsDate = date.toDate();
    onFromDateChange(jsDate);
    onApply(); // auto-apply on change
  };

  // Handle end-date changes: update internal state and notify parent
  const handleToDateChange = (date: DateObject) => {
    setToDateValue(date);
    const jsDate = date.toDate();
    onToDateChange(jsDate);
    onApply(); // auto-apply on change
  };

  const toggleDatePicker = () => setIsOpen(!isOpen);

  const handleApply = () => {
    setIsOpen(false);
    onApply();
  };

  return (
    <div className="relative">
      <div
        ref={triggerRef}
        className="flex items-center h-10 leading-[40px] px-3 border rounded cursor-pointer bg-white hover:border-gray-400 focus-within:border-gray-400"
        style={{ minWidth: '260px', direction: 'rtl', textAlign: 'right', borderColor: 'rgba(0,0,0,0.23)' }}
        onClick={toggleDatePicker}
      >
        <span
          className="fa-font"
          style={{ textAlign: 'right', direction: 'rtl', minWidth: '320px', display: 'inline-block', whiteSpace: 'nowrap' }}
        >
          {fromDateValue
            ? fromDateValue.format(includeTime ? 'YYYY/MM/DD HH:mm' : 'YYYY/MM/DD')
            : 'انتخاب تاریخ شروع'}{' '}
          تا{' '}
          {toDateValue
            ? toDateValue.format(includeTime ? 'YYYY/MM/DD HH:mm' : 'YYYY/MM/DD')
            : 'انتخاب تاریخ پایان'}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 002 2v12a2 2 0 002 2z" />
        </svg>
      </div>

      {isOpen && (
        <div
          ref={dialogRef}
          className="fixed z-[1000] bg-white shadow-lg rounded-md p-4 border"
          style={{
             direction: 'rtl',
             height: '60vh',
             width: '50vw',
             minWidth: '600px',
             maxWidth: '1200px',
             maxHeight: '90vh',
             overflowY: 'auto',
             position: 'fixed',
             transform: 'translate(-50%, 0)',
             left: '50%',
             top: '15%',
             borderColor: 'rgba(0,0,0,0.23)'
           }}
        >
          <div className="flex flex-row gap-12 justify-center">
            <div>
              <label className="block mb-2 fa-font">از تاریخ:</label>
              <DatePicker
                ref={fromDatePickerRef}
                value={fromDateValue}
                onChange={handleFromDateChange}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                format={includeTime ? 'YYYY/MM/DD HH:mm' : 'YYYY/MM/DD'}
                className="teal"
                inputClass="w-full h-10 leading-[40px] rounded-lg px-3 border border-gray-300 focus:border-gray-400 focus:ring-0"
                style={{ minWidth: '300px', direction: 'rtl' }}
                containerStyle={{ direction: 'rtl' }}
                onClose={() => false}
                onOpen={() => {}}
                plugins={includeTime ? [<TimePicker position="bottom" />] : []}
              />
            </div>
            <div>
              <label className="block mb-2 fa-font">تا تاریخ:</label>
              <DatePicker
                ref={toDatePickerRef}
                value={toDateValue}
                onChange={handleToDateChange}
                calendar={persian}
                locale={persian_fa}
                calendarPosition="bottom-right"
                format={includeTime ? 'YYYY/MM/DD HH:mm' : 'YYYY/MM/DD'}
                className="teal"
                inputClass="w-full h-10 leading-[40px] rounded-lg px-3 border border-gray-300 focus:border-gray-400 focus:ring-0"
                style={{ minWidth: '300px', direction: 'rtl' }}
                containerStyle={{ direction: 'rtl' }}
                onClose={() => false}
                onOpen={() => {}}
                plugins={includeTime ? [<TimePicker position="bottom" />] : []}
              />
            </div>
          </div>
          {/* Apply button is optional; changes auto-apply on date change */}
        </div>
      )}
    </div>
  );
};

export default JalaliDateRangePicker;