Excellent — Below I present a **detailed and organized review** of the “Sepidar Receipt and Payment System (Treasury)”: functional description, key components, workflows, accounting and operational controls, potential strengths and weaknesses, suggested settings, and a testing checklist for implementation/acceptance. Wherever technical and citation information was available, I have included an official or educational source. ([Sepidar System][1])

# 1 — Overall Performance Summary

The “Receipt and Payment” module in Sepidar is responsible for managing cash and bank flows, checks, card readers (POS), payroll, and treasury-related operations. This module, while recording treasury operations, generates or assists in issuing the necessary accounting documents, and provides the accountant with tools such as bank reconciliation, bank statement upload (Excel), and check management. ([System Overview][1])

# 2 — Key Components and Capabilities (with detailed description)

1. Definition and Management of Accounts

* Definition of **Cash Registers, Bank Accounts, Card Readers** and maintenance of their identification (account number, branch, currency type if using the currency subsystem). ([YouTube][2])

2. Receipt/Payment Operations (Receipt/Payment)

* Registration of receipts, payment registration, cash management, issuing internal transfers, transfers between the cash register and the bank and vice versa. With each operation, the relevant accounting document can be generated or manually registered. ([System Overview][1])

3. Management and Circulation of Checks

* Registration of checks receivable and payable, request/assignment, cashing, returns, refunds and exchange of checks. There are operational forms for all check situations and the possibility of entering the account number/maturity/party and registering the status of checks is available. ([System Dashboard][3])

4. Bank Reconciliation

* Acceptance of bank statement file (can be loaded from Excel/CSV), automatic reconciliation between system documents and bank statements, and card reader settlement tool and issuance of corrective documents. ([Soft Account][4])

5. Currency Subsystem (if activated)

* Ability to register various currencies, issue currency documents and generate automatic exchange/conversion documents for balances based on defined rates. This subsystem is usually an add-on and must be activated. ([System Dashboard][5])

6. Reports and Dashboards

* Cash and bank account balances, check circulation, receipts/payments list, bank reconciliation report and treasury management reports. ([System Manager][1])

7. Integration with other modules

* Automatic or semi-automatic generation of accounting documents that are sent to the central accounting module; communication with the sales/purchase module for invoice settlement and with the warehouse/salary for the exchange of relevant information. ([System Manager][1])

# 3 — Typical workflows and implementation tips

* Registering cash sales receipt → Select cashier/card reader → Create receipt → Issuance of cashier/sales creditor accounting document.
* Receiving checks from customers → Registering “check received” in the system with due date → On due date, “cash” or “assign” → Relevant documents are issued at each stage. ([System Manager][3])
* Monthly reconciliation: Upload bank statement (Excel) → Run automatic reconciliation → Check outstanding items → Issuance of adjustment documents or bank follow-up. ([Soft Account][4])

# 4 — Accounting and Control Controls to be Enabled/Monitored

* Mandatory **Detailed Account** Assignment for Each Receipt/Payment Flow (for Proper Tracking).
* Rule: **Each Receipt or Payment Must Be Linked to a Bank or Cash Account**; Transfers Between Accounts Must Be Documented Internally.
* Prevent Final Document from Being Posted Until **Balanced** (in the General Accounting System) — Especially for Check and Multicurrency Transactions.
* Control Over Check Due Dates (Alerts for Near Due or Returned Checks).
* Permission Restrictions: Which Users/Groups Are Allowed to Post, Approve, or Delete Treasury Transactions. ([System Management][1])

# 5 — Strengths (Summary of Documentation and Tutorials)

* Centralized User Interface for Checks, Bank, and Cash; Suitable for Small and Medium Businesses. ([System Server][1])
* Ability to upload bank statements and automatically reconcile (time saving). ([Soft Account][4])
* Multiple tutorials and documentation (video/book/blog) that facilitate implementation and use. ([YouTube][2])

# 6 — Common limitations and risks (things to consider during an audit)

1. **Initial settings and account coding**: If account coding is not accurate, reports and discrepancies will be displayed incorrectly — requires standard coding implementation.
2. **Multi-currency**: The currency subsystem is usually an add-on — if not enabled, currency/conversion operations will be problematic; implementation of conversion and rates must be consistent with the company’s financial policy. ([System Manager][5])
3. **Bank File Upload**: Different bank file formats need to be adapted/converted; a standard format and file entry instructions should be established. ([Soft Account][4])
4. **Access Control and Segregation of Duties (SoD)**: If someone performs both registration and verification, the risk of fraud increases — segregation of roles is required.
5. **Corrective Processes (Void/Reverse)**: Voiding or reversing of check and receipt operations should be done with full logging and documented reasons to maintain a clear record. ([System Manager][3])

# 7 — Implementation Settings and Recommendations (Operational)

Before deployment, implement and test a prototype accounting and workflow for 3-5 typical scenarios (cash receipt, check receipt, vendor payment, interbank transfer, bank reconciliation).
Sepidar System

Activate the foreign exchange subsystem if there are foreign exchange transactions and define daily/weekly exchange rates and periodic exchange process.
Sepidar System

Define the bank statement input format (Excel/CSV) and implement an automatic conversion process for each high-trading bank.
Soft Accounting

Create job roles: treasury registrar, approver, reconciliation officer, and inspector; with logging of all operations.

Prepare an internal (updated) user guide for the finance unit, including exception scenarios (returned check, large discrepancy).

# 8 — Acceptance Checklist — Applicable to the project

Record a cash receipt and generate an automatic accounting document — Is the cash balance correct?

Record a check receipt and then “cash” it on the due date — Track the check in reports?

Load a sample bank statement file and run an automatic reconciliation — Show the percentage of matching and balances.
Soft Account

Transfer between two bank accounts — Is the transfer document generated and the balance of each account corrected?

Record a payment to a vendor and settle the related invoice — Is the purchase/settlement document linked correctly?

Role test: An unauthorized user cannot make a final document or delete it.

(If necessary) Record a currency transaction and run a rate conversion — Is the conversion document generated?
Sepidar System

# 9 — Critical reports to be created/reviewed

Check circulation report based on status (received, requested, cashed, returned);

Bank statement and reconciliation report with CSV output;

List of unrecorded/provisional receipts and payments;

Card reader/POS reconciliation report;

Treasury management report (daily/weekly/monthly) with cash/bank/cost center filter.
Sepidar System
+1

# 10 — Suggestion for a technical inspection report (if you want me to prepare it for you)

I can produce a technical inspection report (PDF or Excel) including the following:

Description of the current situation (statistics and observations)

List of prioritized and risk-based issues

Remediation suggestions with estimated time/operational impact
- If you would like, please provide the company name/access level or a sample output (screenshot or sample CSV) to make the report more precise — or I will prepare a generic template for you to fill out yourself.