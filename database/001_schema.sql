-- ============================================================================
-- ERP Schema Migration 001: Core schema (v2 — account code as PK)
--
-- Change requests applied:
--   1. accounts table has NO surrogate id column. accounts.code (VARCHAR)
--      is the primary key and keeps leading zeros. parent is parent_code.
--      Every reference to an account elsewhere uses account_code.
--   2. users.password stores the password exactly as entered (plain text).
--      No hashing, no argon2, no bcrypt. Login compares directly.
--   4. account_details table holds ~60 optional business detail fields per
--      account (General, Contact, Tax/Legal, Credit, Personal, Bank, Photos,
--      Budget) — properly typed columns, not JSON.
--
-- This is a clean-slate rewrite. Drop the database and re-run 000 + 001.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;
-- Required SET options for computed columns and filtered indexes:
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;

-- ============================================================================
-- 1. Settings (singleton)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'settings')
BEGIN
    CREATE TABLE dbo.settings (
        id                  TINYINT         NOT NULL CONSTRAINT PK_settings PRIMARY KEY CHECK (id = 1),
        company_name        NVARCHAR(200)   NOT NULL,
        company_id          NVARCHAR(50)    NOT NULL,
        address             NVARCHAR(500)   NULL,
        phone               NVARCHAR(50)    NULL,
        email               NVARCHAR(100)   NULL,
        ntn                 NVARCHAR(50)    NULL,
        strn                NVARCHAR(50)    NULL,
        logo_path           NVARCHAR(500)   NULL,
        default_branch_id   INT             NULL,
        default_store_id    INT             NULL,
        decimals_amount     TINYINT         NOT NULL DEFAULT 2 CHECK (decimals_amount BETWEEN 0 AND 4),
        decimals_quantity   TINYINT         NOT NULL DEFAULT 2 CHECK (decimals_quantity BETWEEN 0 AND 4),
        decimals_rate       TINYINT         NOT NULL DEFAULT 2 CHECK (decimals_rate BETWEEN 0 AND 4),
        allow_negative_stock BIT            NOT NULL DEFAULT 0,
        branch_digits_per_level     VARCHAR(20) NOT NULL DEFAULT '2,3,3,3,3',
        store_digits_per_level      VARCHAR(20) NOT NULL DEFAULT '2,3,3,3,3',
        product_digits_per_level    VARCHAR(20) NOT NULL DEFAULT '2,3,3,3,3',
        coa_digits_per_level        VARCHAR(40) NOT NULL DEFAULT '2,3,3,3,3,3',
        coa_max_levels              TINYINT     NOT NULL DEFAULT 6,
        branch_max_levels           TINYINT     NOT NULL DEFAULT 5,
        store_max_levels            TINYINT     NOT NULL DEFAULT 5,
        product_max_levels          TINYINT     NOT NULL DEFAULT 5,
        accounting_type     VARCHAR(20)   NOT NULL DEFAULT 'KNOCK_OFF' CHECK (accounting_type IN ('KNOCK_OFF','FIFO')),
        aging_bucket_1 INT NOT NULL DEFAULT 30,
        aging_bucket_2 INT NOT NULL DEFAULT 60,
        aging_bucket_3 INT NOT NULL DEFAULT 90,
        -- Mapped accounts (FK to accounts.code — added later, after accounts exists)
        default_cash_account_code        VARCHAR(40) NULL,
        default_bank_account_code        VARCHAR(40) NULL,
        sales_account_code               VARCHAR(40) NULL,
        sales_returns_account_code       VARCHAR(40) NULL,
        output_sales_tax_account_code    VARCHAR(40) NULL,
        input_sales_tax_account_code     VARCHAR(40) NULL,
        inventory_account_code           VARCHAR(40) NULL,
        cogs_account_code                VARCHAR(40) NULL,
        grn_clearing_account_code        VARCHAR(40) NULL,
        purchase_price_variance_account_code VARCHAR(40) NULL,
        stock_adjustment_account_code    VARCHAR(40) NULL,
        print_settings    NVARCHAR(MAX)  NULL,
        created_at        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_settings_singleton CHECK (id = 1)
    );
END
GO

-- ============================================================================
-- 2. Master ID counter (never-reuse counters for flat-ID masters)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'master_counter')
BEGIN
    CREATE TABLE dbo.master_counter (
        counter_type      VARCHAR(40)  NOT NULL CONSTRAINT PK_master_counter PRIMARY KEY,
        next_value        INT           NOT NULL DEFAULT 1,
        CHECK (next_value > 0)
    );
END
GO

-- ============================================================================
-- 3. Document numbering counter (per branch_short / type / fiscal_year)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'doc_number_counter')
BEGIN
    CREATE TABLE dbo.doc_number_counter (
        branch_short   VARCHAR(20)  NOT NULL,
        doc_type       VARCHAR(5)   NOT NULL,
        fiscal_year    INT          NOT NULL,
        next_serial    INT          NOT NULL DEFAULT 1,
        CONSTRAINT PK_doc_number_counter PRIMARY KEY (branch_short, doc_type, fiscal_year),
        CHECK (next_serial > 0),
        CHECK (doc_type IN ('SO','DC','SI','CN','PR','PO','RC','PI','DN','CRV','CPV','BRV','BPV','JV','MV','SA','OS'))
    );
END
GO

-- ============================================================================
-- 4. Fiscal years
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'fiscal_years')
BEGIN
    CREATE TABLE dbo.fiscal_years (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_fiscal_years PRIMARY KEY,
        name            NVARCHAR(50)  NOT NULL,
        start_date      DATE          NOT NULL,
        end_date        DATE          NOT NULL,
        is_active       BIT           NOT NULL DEFAULT 1,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_fy_name UNIQUE (name),
        CONSTRAINT UQ_fy_dates UNIQUE (start_date, end_date),
        CHECK (end_date > start_date)
    );
END
GO

-- ============================================================================
-- 5. Branches (tree, level-coded)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'branches')
BEGIN
    CREATE TABLE dbo.branches (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_branches PRIMARY KEY,
        code            VARCHAR(30)  NOT NULL,
        parent_id       INT          NULL,
        level_no        TINYINT      NOT NULL DEFAULT 1,
        name            NVARCHAR(200) NOT NULL,
        short_name      VARCHAR(20)  NOT NULL,
        address         NVARCHAR(500) NULL,
        phone           NVARCHAR(50)  NULL,
        email           NVARCHAR(100) NULL,
        is_active        BIT          NOT NULL DEFAULT 1,
        row_version     ROWVERSION  NOT NULL,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_branches_code UNIQUE (code),
        CONSTRAINT UQ_branches_short_name UNIQUE (short_name),
        CONSTRAINT FK_branches_parent FOREIGN KEY (parent_id) REFERENCES dbo.branches(id),
        CHECK (level_no BETWEEN 1 AND 5)
    );
END
GO

-- ============================================================================
-- 6. Stores (tree; leaf holds stock)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stores')
BEGIN
    CREATE TABLE dbo.stores (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_stores PRIMARY KEY,
        code            VARCHAR(30)  NOT NULL,
        parent_id       INT          NULL,
        level_no        TINYINT      NOT NULL DEFAULT 1,
        name            NVARCHAR(200) NOT NULL,
        store_type      VARCHAR(20)  NOT NULL DEFAULT 'STOCK' CHECK (store_type IN ('GROUP','STOCK')),
        is_active        BIT          NOT NULL DEFAULT 1,
        row_version     ROWVERSION  NOT NULL,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_stores_code UNIQUE (code),
        CONSTRAINT FK_stores_parent FOREIGN KEY (parent_id) REFERENCES dbo.stores(id),
        CHECK (level_no BETWEEN 1 AND 5)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'store_branch_tags')
BEGIN
    CREATE TABLE dbo.store_branch_tags (
        store_id    INT NOT NULL,
        branch_id   INT NOT NULL,
        CONSTRAINT PK_store_branch_tags PRIMARY KEY (store_id, branch_id),
        CONSTRAINT FK_sbt_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_sbt_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id)
    );
END
GO

-- ============================================================================
-- 7. Units
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'units')
BEGIN
    CREATE TABLE dbo.units (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_units PRIMARY KEY,
        display_id      VARCHAR(10) NOT NULL,
        code            VARCHAR(10) NOT NULL,
        name            NVARCHAR(50) NOT NULL,
        is_active        BIT          NOT NULL DEFAULT 1,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_units_display_id UNIQUE (display_id),
        CONSTRAINT UQ_units_code UNIQUE (code)
    );
END
GO

-- ============================================================================
-- 8. Chart of Accounts — code is the PK. NO surrogate id column.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'accounts')
BEGIN
    CREATE TABLE dbo.accounts (
        code            VARCHAR(40)  NOT NULL CONSTRAINT PK_accounts PRIMARY KEY,
        parent_code     VARCHAR(40)  NULL,
        level_no        TINYINT      NOT NULL DEFAULT 1,
        name            NVARCHAR(200) NOT NULL,
        nature          VARCHAR(20)  NOT NULL CHECK (nature IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
        is_group        BIT          NOT NULL DEFAULT 0,
        is_posting      AS (CASE WHEN is_group = 0 THEN 1 ELSE 0 END) PERSISTED,
        is_cash         BIT          NOT NULL DEFAULT 0,
        is_bank         BIT          NOT NULL DEFAULT 0,
        party_type      VARCHAR(20)  NOT NULL DEFAULT 'NONE' CHECK (party_type IN ('NONE','CUSTOMER','SUPPLIER')),
        is_active        BIT          NOT NULL DEFAULT 1,
        row_version     ROWVERSION  NOT NULL,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_accounts_parent FOREIGN KEY (parent_code) REFERENCES dbo.accounts(code),
        CHECK (level_no BETWEEN 1 AND 6)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounts_parent')
    CREATE INDEX IX_accounts_parent ON dbo.accounts(parent_code);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounts_nature')
    CREATE INDEX IX_accounts_nature ON dbo.accounts(nature) INCLUDE (code, name);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_accounts_party')
    CREATE INDEX IX_accounts_party ON dbo.accounts(party_type) WHERE party_type <> 'NONE';
GO

-- ----------------------------------------------------------------------------
-- 8a. account_details — one row per account, properly typed columns.
--     All fields OPTIONAL except account_code (FK to accounts.code).
-- ----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'account_details')
BEGIN
    CREATE TABLE dbo.account_details (
        account_code        VARCHAR(40) NOT NULL CONSTRAINT PK_account_details PRIMARY KEY,
        CONSTRAINT FK_acd_account FOREIGN KEY (account_code) REFERENCES dbo.accounts(code) ON DELETE CASCADE,

        -- General
        account_title       NVARCHAR(200) NULL,    -- printed name
        short_name          NVARCHAR(50)  NULL,
        reference_number    NVARCHAR(50)  NULL,
        external_code       NVARCHAR(50)  NULL,
        serial_number       INT            NULL,
        account_status      VARCHAR(20)   NULL CHECK (account_status IN ('ACTIVE','INACTIVE','BLOCKED','ON_HOLD')),
        registration_date   DATE          NULL,
        customer_supplier_category NVARCHAR(100) NULL,
        customer_type       NVARCHAR(100) NULL,
        business_type       NVARCHAR(100) NULL,
        remarks_notes       NVARCHAR(MAX)  NULL,

        -- Contact and address
        contact_persons_json NVARCHAR(MAX) NULL,  -- repeating list (name/designation/phone/mobile/email)
        address_line1        NVARCHAR(200) NULL,
        address_line2        NVARCHAR(200) NULL,
        address_line3        NVARCHAR(200) NULL,
        area                 NVARCHAR(100) NULL,
        city                 NVARCHAR(100) NULL,
        province_state       NVARCHAR(100) NULL,
        postal_code          NVARCHAR(20)  NULL,
        country              NVARCHAR(50)  NULL,
        telephone            NVARCHAR(50)  NULL,
        residence_telephone  NVARCHAR(50)  NULL,
        mobile_number        NVARCHAR(50)  NULL,
        whatsapp_number      NVARCHAR(50)  NULL,
        fax_number           NVARCHAR(50)  NULL,
        email                NVARCHAR(100) NULL,
        website              NVARCHAR(200) NULL,
        uan_helpline         NVARCHAR(50)  NULL,
        delivery_address     NVARCHAR(500) NULL,
        billing_address      NVARCHAR(500) NULL,

        -- Tax and legal
        ntn                  NVARCHAR(50)  NULL,
        strn                 NVARCHAR(50)  NULL,
        gst_number           NVARCHAR(50)  NULL,
        cnic_nic_number      NVARCHAR(50)  NULL,
        nicop                NVARCHAR(50)  NULL,
        cnic_expiry_date     DATE          NULL,
        tax_payer_type       NVARCHAR(50)  NULL,
        tax_payer_status     NVARCHAR(50)  NULL,   -- filer/non-filer/active/inactive
        tax_type             NVARCHAR(50)  NULL,
        withholding_tax_applicable BIT      NULL,
        additional_withholding_applicable BIT NULL,
        srb_provincial_tax_number NVARCHAR(50) NULL,
        exemption_certificate_number NVARCHAR(50) NULL,
        exemption_certificate_expiry DATE NULL,
        license_number       NVARCHAR(50)  NULL,
        license_expiry_date  DATE          NULL,
        registration_authority NVARCHAR(200) NULL,

        -- Credit and commercial
        credit_days          INT           NULL,
        credit_amount        DECIMAL(18,2) NULL,
        commission_percent   DECIMAL(7,4)  NULL,
        default_discount_percent DECIMAL(7,4) NULL,
        default_salesman     NVARCHAR(100) NULL,
        price_level          VARCHAR(20)   NULL CHECK (price_level IN ('RETAIL','WHOLESALE','RESALE','COST','OTHER')),
        payment_terms        NVARCHAR(200) NULL,
        currency             NVARCHAR(10)  NULL,
        territory_route      NVARCHAR(100) NULL,
        opening_remarks      NVARCHAR(MAX) NULL,
        default_process_notes NVARCHAR(MAX) NULL,
        care_of_account_code VARCHAR(40)   NULL,    -- link to another account
        cash_flow_classification NVARCHAR(50) NULL,
        allow_sales          BIT           NULL,
        allow_purchases      BIT           NULL,

        -- Personal (individuals / staff-type)
        father_husband_name  NVARCHAR(100) NULL,
        nationality          NVARCHAR(50)  NULL,
        occupation           NVARCHAR(100) NULL,
        monthly_income       DECIMAL(18,2) NULL,
        customer_age         INT           NULL,
        number_of_dependents INT           NULL,
        date_of_birth        DATE          NULL,
        gender               VARCHAR(10)   NULL,
        marital_status       VARCHAR(20)   NULL,
        emergency_contact    NVARCHAR(200) NULL,

        -- Bank details
        bank_name            NVARCHAR(200) NULL,
        bank_prefix          NVARCHAR(20)  NULL,
        bank_account_name    NVARCHAR(200) NULL,
        bank_account_number  NVARCHAR(50)  NULL,
        iban                 NVARCHAR(50)  NULL,
        bank_account_type    VARCHAR(20)   NULL CHECK (bank_account_type IN ('CURRENT','SAVINGS','OTHER')),
        bank_currency        NVARCHAR(10)  NULL,
        bank_branch_code     NVARCHAR(20)  NULL,
        bank_branch_name     NVARCHAR(200) NULL,
        bank_branch_address  NVARCHAR(500) NULL,
        bank_branch_city     NVARCHAR(100) NULL,
        swift_code           NVARCHAR(20)  NULL,
        lc_limit             DECIMAL(18,2) NULL,
        bank_charges         DECIMAL(18,2) NULL,
        signatories_json     NVARCHAR(MAX) NULL,   -- repeating list of signatories
        cheque_book_range_from VARCHAR(50) NULL,
        cheque_book_range_to   VARCHAR(50) NULL,
        current_cheque_number  NVARCHAR(50) NULL,
        cheque_print_format    NVARCHAR(MAX) NULL,
        pay_order_online_ref_notes NVARCHAR(MAX) NULL,

        -- Photos (paths only; files on disk under uploads/account_photos/)
        nic_photo_path       NVARCHAR(500) NULL,
        person_photo_path    NVARCHAR(500) NULL,
        photo1_path          NVARCHAR(500) NULL,
        photo1_label         NVARCHAR(100) NULL,
        photo2_path          NVARCHAR(500) NULL,
        photo2_label         NVARCHAR(100) NULL,

        -- Budget (Jan-Dec)
        budget_jan           DECIMAL(18,2) NULL,
        budget_feb           DECIMAL(18,2) NULL,
        budget_mar           DECIMAL(18,2) NULL,
        budget_apr           DECIMAL(18,2) NULL,
        budget_may           DECIMAL(18,2) NULL,
        budget_jun           DECIMAL(18,2) NULL,
        budget_jul           DECIMAL(18,2) NULL,
        budget_aug           DECIMAL(18,2) NULL,
        budget_sep           DECIMAL(18,2) NULL,
        budget_oct           DECIMAL(18,2) NULL,
        budget_nov           DECIMAL(18,2) NULL,
        budget_dec           DECIMAL(18,2) NULL,

        -- Tag branches (multi-select via side table)
        -- Stored in account_branch_tags (see below)

        updated_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

-- account_branch_tags: many-to-many between accounts and branches
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'account_branch_tags')
BEGIN
    CREATE TABLE dbo.account_branch_tags (
        account_code  VARCHAR(40) NOT NULL,
        branch_id     INT          NOT NULL,
        CONSTRAINT PK_account_branch_tags PRIMARY KEY (account_code, branch_id),
        CONSTRAINT FK_abt_account FOREIGN KEY (account_code) REFERENCES dbo.accounts(code) ON DELETE CASCADE,
        CONSTRAINT FK_abt_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id)
    );
END
GO

-- Care-of self-reference (already on account_details.care_of_account_code)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_acd_care_of')
    ALTER TABLE dbo.account_details WITH CHECK ADD CONSTRAINT FK_acd_care_of
    FOREIGN KEY (care_of_account_code) REFERENCES dbo.accounts(code);
GO

-- Now that accounts exists, add the FKs from settings → accounts.code
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_default_cash')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_default_cash
    FOREIGN KEY (default_cash_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_default_bank')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_default_bank
    FOREIGN KEY (default_bank_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_sales')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_sales
    FOREIGN KEY (sales_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_sales_returns')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_sales_returns
    FOREIGN KEY (sales_returns_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_output_tax')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_output_tax
    FOREIGN KEY (output_sales_tax_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_input_tax')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_input_tax
    FOREIGN KEY (input_sales_tax_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_inventory')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_inventory
    FOREIGN KEY (inventory_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_cogs')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_cogs
    FOREIGN KEY (cogs_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_grn_clearing')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_grn_clearing
    FOREIGN KEY (grn_clearing_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_ppv')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_ppv
    FOREIGN KEY (purchase_price_variance_account_code) REFERENCES dbo.accounts(code);
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_settings_stock_adj')
    ALTER TABLE dbo.settings WITH CHECK ADD CONSTRAINT FK_settings_stock_adj
    FOREIGN KEY (stock_adjustment_account_code) REFERENCES dbo.accounts(code);
GO

-- ============================================================================
-- 9. Tax Heads (linked account is by account_code)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'tax_heads')
BEGIN
    CREATE TABLE dbo.tax_heads (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tax_heads PRIMARY KEY,
        display_id      VARCHAR(10)  NOT NULL,
        name            NVARCHAR(100) NOT NULL,
        account_code    VARCHAR(40)  NOT NULL,
        percentage       DECIMAL(7,4) NOT NULL CHECK (percentage BETWEEN 0 AND 100),
        is_active        BIT          NOT NULL DEFAULT 1,
        row_version     ROWVERSION  NOT NULL,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_tax_heads_display_id UNIQUE (display_id),
        CONSTRAINT FK_tax_heads_account FOREIGN KEY (account_code) REFERENCES dbo.accounts(code)
    );
END
GO

-- ============================================================================
-- 10. Users (plain-text password — NO hashing)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
BEGIN
    CREATE TABLE dbo.users (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_users PRIMARY KEY,
        display_id      VARCHAR(10)  NOT NULL,
        username        NVARCHAR(100) NOT NULL,
        full_name       NVARCHAR(200) NOT NULL,
        password        NVARCHAR(255) NOT NULL,    -- plain text, exactly as entered
        is_active        BIT          NOT NULL DEFAULT 1,
        is_admin         BIT          NOT NULL DEFAULT 0,
        allowed_branches_csv VARCHAR(500) NULL,
        allowed_stores_csv  VARCHAR(500) NULL,
        row_version     ROWVERSION  NOT NULL,
        last_login_at   DATETIME2     NULL,
        failed_login_count INT        NOT NULL DEFAULT 0,
        locked_until    DATETIME2     NULL,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_users_display_id UNIQUE (display_id),
        CONSTRAINT UQ_users_username UNIQUE (username),
        CHECK (LEN(password) > 0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_permissions')
BEGIN
    CREATE TABLE dbo.user_permissions (
        user_id         INT NOT NULL,
        screen_code      VARCHAR(60) NOT NULL,
        can_view         BIT NOT NULL DEFAULT 0,
        can_add          BIT NOT NULL DEFAULT 0,
        can_edit         BIT NOT NULL DEFAULT 0,
        can_delete       BIT NOT NULL DEFAULT 0,
        can_print        BIT NOT NULL DEFAULT 0,
        CONSTRAINT PK_user_permissions PRIMARY KEY (user_id, screen_code),
        CONSTRAINT FK_user_perm_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
    );
END
GO

-- ============================================================================
-- 11. Audit log (append-only)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'audit_log')
BEGIN
    CREATE TABLE dbo.audit_log (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_audit_log PRIMARY KEY,
        event_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        user_id         INT          NULL,
        user_name       NVARCHAR(200) NULL,
        ip_address      VARCHAR(45)  NULL,
        screen_code      VARCHAR(60)  NULL,
        action           VARCHAR(30)  NOT NULL,
        record_type      VARCHAR(40)  NULL,
        record_id        NVARCHAR(50) NULL,
        record_number    NVARCHAR(50) NULL,
        before_values    NVARCHAR(MAX) NULL,
        after_values     NVARCHAR(MAX) NULL,
        CONSTRAINT FK_audit_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_event_at')
    CREATE INDEX IX_audit_event_at ON dbo.audit_log(event_at) INCLUDE (user_name, screen_code, action);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_user')
    CREATE INDEX IX_audit_user ON dbo.audit_log(user_id, event_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_screen_action')
    CREATE INDEX IX_audit_screen_action ON dbo.audit_log(screen_code, action, event_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_record')
    CREATE INDEX IX_audit_record ON dbo.audit_log(record_type, record_number);
GO

-- ============================================================================
-- 12. Products (tree)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'products')
BEGIN
    CREATE TABLE dbo.products (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_products PRIMARY KEY,
        code            VARCHAR(40)  NOT NULL,
        parent_id       INT          NULL,
        level_no        TINYINT      NOT NULL DEFAULT 1,
        name            NVARCHAR(200) NOT NULL,
        unit_id         INT          NULL,
        sales_tax_pct    DECIMAL(7,4) NOT NULL DEFAULT 0,
        reorder_level    DECIMAL(18,4) NOT NULL DEFAULT 0,
        purchase_price   DECIMAL(18,4) NOT NULL DEFAULT 0,
        sales_price      DECIMAL(18,4) NOT NULL DEFAULT 0,
        is_group        BIT          NOT NULL DEFAULT 0,
        is_active        BIT          NOT NULL DEFAULT 1,
        row_version     ROWVERSION  NOT NULL,
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_products_code UNIQUE (code),
        CONSTRAINT FK_products_parent FOREIGN KEY (parent_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_products_unit FOREIGN KEY (unit_id) REFERENCES dbo.units(id),
        CHECK (level_no BETWEEN 1 AND 5),
        CHECK (is_group = 1 OR unit_id IS NOT NULL)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_products_parent')
    CREATE INDEX IX_products_parent ON dbo.products(parent_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_products_active')
    CREATE INDEX IX_products_active ON dbo.products(is_active) INCLUDE (code, name);
GO

-- ============================================================================
-- 13. Vouchers — all account references use account_code
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'vouchers')
BEGIN
    CREATE TABLE dbo.vouchers (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_vouchers PRIMARY KEY,
        voucher_no      VARCHAR(40)  NOT NULL,
        voucher_type     VARCHAR(5)   NOT NULL CHECK (voucher_type IN ('CRV','CPV','BRV','BPV','JV')),
        doc_date         DATE         NOT NULL,
        fiscal_year_id   INT          NOT NULL,
        branch_id        INT          NOT NULL,
        cash_account_code  VARCHAR(40)  NULL,
        bank_account_code  VARCHAR(40)  NULL,
        payment_type     VARCHAR(10) NULL CHECK (payment_type IN ('CHEQUE','ONLINE')),
        cheque_no        VARCHAR(50)  NULL,
        cheque_date      DATE         NULL,
        cheque_bank_name NVARCHAR(200) NULL,
        cheque_status    VARCHAR(10)  NULL CHECK (cheque_status IN ('ISSUED','CLEARED','BOUNCED','CANCELLED')),
        cheque_status_date DATE      NULL,
        reference        NVARCHAR(200) NULL,
        narration        NVARCHAR(1000) NULL,
        tax_head_id      INT          NULL,
        tax_percentage   DECIMAL(7,4)  NULL,
        gross_amount     DECIMAL(18,2) NULL,
        tax_amount       DECIMAL(18,2) NULL,
        net_amount       DECIMAL(18,2) NULL,
        counter_account_code VARCHAR(40) NULL,
        status           VARCHAR(20)  NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
        reversed_by_voucher_id BIGINT  NULL,
        created_by       INT          NOT NULL,
        created_at       DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at       DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version      ROWVERSION NOT NULL,
        CONSTRAINT UQ_vouchers_no UNIQUE (voucher_no),
        CONSTRAINT FK_vouchers_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_vouchers_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_vouchers_cash_acct FOREIGN KEY (cash_account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_vouchers_bank_acct FOREIGN KEY (bank_account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_vouchers_counter FOREIGN KEY (counter_account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_vouchers_tax_head FOREIGN KEY (tax_head_id) REFERENCES dbo.tax_heads(id),
        CONSTRAINT FK_vouchers_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CHECK (NOT (voucher_type = 'JV' AND (cash_account_code IS NOT NULL OR bank_account_code IS NOT NULL)))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_vouchers_date')
    CREATE INDEX IX_vouchers_date ON dbo.vouchers(doc_date, voucher_type) INCLUDE (voucher_no, branch_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_vouchers_branch_type')
    CREATE INDEX IX_vouchers_branch_type ON dbo.vouchers(branch_id, voucher_type, doc_date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_vouchers_counter')
    CREATE INDEX IX_vouchers_counter ON dbo.vouchers(counter_account_code, doc_date) WHERE counter_account_code IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_vouchers_cheque')
    CREATE INDEX IX_vouchers_cheque ON dbo.vouchers(bank_account_code, cheque_status, doc_date) WHERE cheque_status IS NOT NULL;
GO

-- ============================================================================
-- 14. Bills (customer/supplier open bills for knock-off)
--     Defined BEFORE voucher_lines so its FK resolves.
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'bills')
BEGIN
    CREATE TABLE dbo.bills (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bills PRIMARY KEY,
        bill_no         NVARCHAR(50) NOT NULL,
        bill_type       VARCHAR(20) NOT NULL CHECK (bill_type IN ('SALES_INVOICE','PURCHASE_INVOICE','CREDIT_NOTE','DEBIT_NOTE','OPENING','JV_LINE')),
        party_account_code VARCHAR(40) NOT NULL,
        ref_doc_type    VARCHAR(10) NULL,
        ref_doc_id      BIGINT      NULL,
        branch_id       INT         NOT NULL,
        doc_date        DATE        NOT NULL,
        due_date        DATE        NULL,
        gross_amount    DECIMAL(18,2) NOT NULL,
        tax_amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
        net_amount      DECIMAL(18,2) NOT NULL,
        settled_amount  DECIMAL(18,2) NOT NULL DEFAULT 0,
        is_advance      BIT         NOT NULL DEFAULT 0,
        is_open         AS (CAST(CASE WHEN settled_amount < net_amount THEN 1 ELSE 0 END AS BIT)) PERSISTED,
        created_at      DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_bills_no UNIQUE (party_account_code, bill_no),
        CONSTRAINT FK_bills_party FOREIGN KEY (party_account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_bills_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CHECK (net_amount = gross_amount + tax_amount - CASE WHEN bill_type IN ('CREDIT_NOTE','DEBIT_NOTE') THEN 0 ELSE 0 END)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bills_party_open')
    CREATE INDEX IX_bills_party_open ON dbo.bills(party_account_code, is_open, due_date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_bills_doc')
    CREATE INDEX IX_bills_doc ON dbo.bills(ref_doc_type, ref_doc_id) WHERE ref_doc_type IS NOT NULL;
GO

-- ============================================================================
-- 15. Voucher lines (account_code, not account_id)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'voucher_lines')
BEGIN
    CREATE TABLE dbo.voucher_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_voucher_lines PRIMARY KEY,
        voucher_id      BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        account_code    VARCHAR(40)  NOT NULL,
        debit           DECIMAL(18,2) NOT NULL DEFAULT 0,
        credit          DECIMAL(18,2) NOT NULL DEFAULT 0,
        line_narration  NVARCHAR(500) NULL,
        bill_id         BIGINT       NULL,
        amount_applied  DECIMAL(18,2) NULL,
        CONSTRAINT PK_voucher_lines_pk UNIQUE (voucher_id, line_no),
        CONSTRAINT FK_vl_voucher FOREIGN KEY (voucher_id) REFERENCES dbo.vouchers(id) ON DELETE CASCADE,
        CONSTRAINT FK_vl_account FOREIGN KEY (account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_vl_bill FOREIGN KEY (bill_id) REFERENCES dbo.bills(id),
        CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
    );
END
GO

-- ============================================================================
-- 16. General Ledger (account_code, not account_id)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'gl_entries')
BEGIN
    CREATE TABLE dbo.gl_entries (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_gl_entries PRIMARY KEY,
        voucher_id      BIGINT       NULL,
        ref_doc_type    VARCHAR(10) NULL,
        ref_doc_id      BIGINT      NULL,
        entry_date      DATE         NOT NULL,
        fiscal_year_id  INT          NOT NULL,
        branch_id       INT          NOT NULL,
        account_code    VARCHAR(40)  NOT NULL,
        debit           DECIMAL(18,2) NOT NULL DEFAULT 0,
        credit          DECIMAL(18,2) NOT NULL DEFAULT 0,
        narration       NVARCHAR(500) NULL,
        bill_id         BIGINT       NULL,
        is_opening      BIT          NOT NULL DEFAULT 0,
        is_reconciled   BIT          NOT NULL DEFAULT 0,
        reconcile_date  DATE        NULL,
        created_at      DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_gl_voucher FOREIGN KEY (voucher_id) REFERENCES dbo.vouchers(id),
        CONSTRAINT FK_gl_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_gl_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_gl_account FOREIGN KEY (account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_gl_bill FOREIGN KEY (bill_id) REFERENCES dbo.bills(id),
        CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_gl_account_date')
    CREATE INDEX IX_gl_account_date ON dbo.gl_entries(account_code, entry_date) INCLUDE (debit, credit, branch_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_gl_branch_date')
    CREATE INDEX IX_gl_branch_date ON dbo.gl_entries(branch_id, entry_date) INCLUDE (account_code, debit, credit);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_gl_ref_doc')
    CREATE INDEX IX_gl_ref_doc ON dbo.gl_entries(ref_doc_type, ref_doc_id) WHERE ref_doc_type IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_gl_voucher')
    CREATE INDEX IX_gl_voucher ON dbo.gl_entries(voucher_id) WHERE voucher_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_gl_reconcile')
    CREATE INDEX IX_gl_reconcile ON dbo.gl_entries(account_code, is_reconciled, entry_date) WHERE account_code IS NOT NULL;
GO

-- ============================================================================
-- 17. Stock balances (per product per store, moving average)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stock_balances')
BEGIN
    CREATE TABLE dbo.stock_balances (
        product_id      INT          NOT NULL,
        store_id        INT          NOT NULL,
        quantity         DECIMAL(18,4) NOT NULL DEFAULT 0,
        avg_cost         DECIMAL(18,4) NOT NULL DEFAULT 0,
        cost_price       DECIMAL(18,4) NULL,
        sales_price      DECIMAL(18,4) NULL,
        wholesale_price  DECIMAL(18,4) NULL,
        resale_price     DECIMAL(18,4) NULL,
        last_updated     DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT PK_stock_balances PRIMARY KEY (product_id, store_id),
        CONSTRAINT FK_sb_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_sb_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id)
    );
END
GO

-- ============================================================================
-- 18. Stock ledger
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stock_ledger')
BEGIN
    CREATE TABLE dbo.stock_ledger (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_stock_ledger PRIMARY KEY,
        doc_type        VARCHAR(10)  NOT NULL CHECK (doc_type IN ('OS','SI','CN','DC','RC','PI','DN','MV','SA')),
        ref_doc_type    VARCHAR(10)  NULL,
        ref_doc_id      BIGINT       NULL,
        doc_date        DATE        NOT NULL,
        product_id      INT         NOT NULL,
        store_id        INT         NOT NULL,
        qty_in          DECIMAL(18,4) NOT NULL DEFAULT 0,
        qty_out         DECIMAL(18,4) NOT NULL DEFAULT 0,
        rate            DECIMAL(18,4) NOT NULL DEFAULT 0,
        balance_after    DECIMAL(18,4) NOT NULL,
        avg_cost_after   DECIMAL(18,4) NOT NULL,
        paired_ledger_id BIGINT      NULL,
        is_reversed     BIT         NOT NULL DEFAULT 0,
        reversed_by_id   BIGINT      NULL,
        narration       NVARCHAR(500) NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_sl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_sl_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_sl_paired FOREIGN KEY (paired_ledger_id) REFERENCES dbo.stock_ledger(id),
        CONSTRAINT FK_sl_reversed_by FOREIGN KEY (reversed_by_id) REFERENCES dbo.stock_ledger(id),
        CHECK ((qty_in > 0 AND qty_out = 0) OR (qty_out > 0 AND qty_in = 0))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sl_product_date')
    CREATE INDEX IX_sl_product_date ON dbo.stock_ledger(product_id, doc_date, id) INCLUDE (store_id, qty_in, qty_out, rate, balance_after, avg_cost_after);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sl_store_product')
    CREATE INDEX IX_sl_store_product ON dbo.stock_ledger(store_id, product_id, doc_date) INCLUDE (qty_in, qty_out);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sl_ref_doc')
    CREATE INDEX IX_sl_ref_doc ON dbo.stock_ledger(ref_doc_type, ref_doc_id) WHERE ref_doc_type IS NOT NULL;
GO

-- ============================================================================
-- 19. Sales module (orders, challans, invoices, credit notes)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sales_orders')
BEGIN
    CREATE TABLE dbo.sales_orders (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sales_orders PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        customer_code   VARCHAR(40) NOT NULL,
        reference       NVARCHAR(200) NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTLY','CLOSED','CANCELLED')),
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_so_no UNIQUE (doc_no),
        CONSTRAINT FK_so_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_so_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_so_customer FOREIGN KEY (customer_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_so_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sales_order_lines')
BEGIN
    CREATE TABLE dbo.sales_order_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sales_order_lines PRIMARY KEY,
        order_id        BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        unit_id         INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        tax_pct         DECIMAL(7,4) NOT NULL DEFAULT 0,
        delivered_qty   DECIMAL(18,4) NOT NULL DEFAULT 0,
        invoiced_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT UQ_sol UNIQUE (order_id, line_no),
        CONSTRAINT FK_sol_order FOREIGN KEY (order_id) REFERENCES dbo.sales_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_sol_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_sol_unit FOREIGN KEY (unit_id) REFERENCES dbo.units(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'delivery_challans')
BEGIN
    CREATE TABLE dbo.delivery_challans (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_challans PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NOT NULL,
        customer_code   VARCHAR(40) NOT NULL,
        sales_order_id  BIGINT      NULL,
        reference       NVARCHAR(200) NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVOICED','CANCELLED')),
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_dc_no UNIQUE (doc_no),
        CONSTRAINT FK_dc_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_dc_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_dc_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_dc_customer FOREIGN KEY (customer_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_dc_so FOREIGN KEY (sales_order_id) REFERENCES dbo.sales_orders(id),
        CONSTRAINT FK_dc_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'delivery_challan_lines')
BEGIN
    CREATE TABLE dbo.delivery_challan_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_challan_lines PRIMARY KEY,
        challan_id      BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        avg_cost_at_post DECIMAL(18,4) NOT NULL,
        invoiced_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT UQ_dcl UNIQUE (challan_id, line_no),
        CONSTRAINT FK_dcl_challan FOREIGN KEY (challan_id) REFERENCES dbo.delivery_challans(id) ON DELETE CASCADE,
        CONSTRAINT FK_dcl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sales_invoices')
BEGIN
    CREATE TABLE dbo.sales_invoices (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sales_invoices PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NULL,
        customer_code   VARCHAR(40) NOT NULL,
        credit_days     INT         NOT NULL DEFAULT 0,
        reference       NVARCHAR(200) NULL,
        subtotal        DECIMAL(18,2) NOT NULL,
        tax_total       DECIMAL(18,2) NOT NULL DEFAULT 0,
        grand_total     DECIMAL(18,2) NOT NULL,
        is_direct        BIT         NOT NULL DEFAULT 0,
        is_returned_all  BIT         NOT NULL DEFAULT 0,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_si_no UNIQUE (doc_no),
        CONSTRAINT FK_si_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_si_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_si_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_si_customer FOREIGN KEY (customer_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_si_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CHECK (grand_total = subtotal + tax_total)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'sales_invoice_lines')
BEGIN
    CREATE TABLE dbo.sales_invoice_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sales_invoice_lines PRIMARY KEY,
        invoice_id      BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        tax_pct         DECIMAL(7,4) NOT NULL DEFAULT 0,
        line_amount     DECIMAL(18,2) NOT NULL,
        line_tax        DECIMAL(18,2) NOT NULL DEFAULT 0,
        avg_cost_at_post DECIMAL(18,4) NOT NULL,
        returned_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        delivery_challan_id BIGINT    NULL,
        delivery_challan_line_id BIGINT NULL,
        CONSTRAINT UQ_sil UNIQUE (invoice_id, line_no),
        CONSTRAINT FK_sil_invoice FOREIGN KEY (invoice_id) REFERENCES dbo.sales_invoices(id) ON DELETE CASCADE,
        CONSTRAINT FK_sil_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_sil_dcl FOREIGN KEY (delivery_challan_line_id) REFERENCES dbo.delivery_challan_lines(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'credit_notes')
BEGIN
    CREATE TABLE dbo.credit_notes (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_credit_notes PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NOT NULL,
        customer_code   VARCHAR(40) NOT NULL,
        original_invoice_id BIGINT  NOT NULL,
        subtotal        DECIMAL(18,2) NOT NULL,
        tax_total       DECIMAL(18,2) NOT NULL DEFAULT 0,
        grand_total     DECIMAL(18,2) NOT NULL,
        reason          NVARCHAR(500) NULL,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_cn_no UNIQUE (doc_no),
        CONSTRAINT FK_cn_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_cn_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_cn_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_cn_customer FOREIGN KEY (customer_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_cn_invoice FOREIGN KEY (original_invoice_id) REFERENCES dbo.sales_invoices(id),
        CONSTRAINT FK_cn_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CHECK (grand_total = subtotal + tax_total)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'credit_note_lines')
BEGIN
    CREATE TABLE dbo.credit_note_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_credit_note_lines PRIMARY KEY,
        credit_note_id  BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        tax_pct         DECIMAL(7,4) NOT NULL DEFAULT 0,
        line_amount     DECIMAL(18,2) NOT NULL,
        line_tax        DECIMAL(18,2) NOT NULL DEFAULT 0,
        original_invoice_line_id BIGINT NOT NULL,
        avg_cost_at_return DECIMAL(18,4) NOT NULL,
        CONSTRAINT UQ_cnl UNIQUE (credit_note_id, line_no),
        CONSTRAINT FK_cnl_cn FOREIGN KEY (credit_note_id) REFERENCES dbo.credit_notes(id) ON DELETE CASCADE,
        CONSTRAINT FK_cnl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_cnl_invoice_line FOREIGN KEY (original_invoice_line_id) REFERENCES dbo.sales_invoice_lines(id)
    );
END
GO

-- ============================================================================
-- 20. Purchase module (requisitions, POs, receiving, invoices, debit notes)
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_requisitions')
BEGIN
    CREATE TABLE dbo.purchase_requisitions (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_requisitions PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        requested_by    NVARCHAR(200) NOT NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_pr_no UNIQUE (doc_no),
        CONSTRAINT FK_pr_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_pr_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_pr_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_requisition_lines')
BEGIN
    CREATE TABLE dbo.purchase_requisition_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_requisition_lines PRIMARY KEY,
        requisition_id  BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        required_by     DATE        NULL,
        purpose         NVARCHAR(500) NULL,
        po_qty          DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT UQ_prl UNIQUE (requisition_id, line_no),
        CONSTRAINT FK_prl_pr FOREIGN KEY (requisition_id) REFERENCES dbo.purchase_requisitions(id) ON DELETE CASCADE,
        CONSTRAINT FK_prl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_orders')
BEGIN
    CREATE TABLE dbo.purchase_orders (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_orders PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        supplier_code   VARCHAR(40) NOT NULL,
        delivery_date   DATE        NULL,
        terms           NVARCHAR(500) NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTLY','CLOSED','CANCELLED')),
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_po_no UNIQUE (doc_no),
        CONSTRAINT FK_po_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_po_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_po_supplier FOREIGN KEY (supplier_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_po_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_order_lines')
BEGIN
    CREATE TABLE dbo.purchase_order_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_order_lines PRIMARY KEY,
        order_id        BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        tax_pct         DECIMAL(7,4) NOT NULL DEFAULT 0,
        received_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        invoiced_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT UQ_pol UNIQUE (order_id, line_no),
        CONSTRAINT FK_pol_order FOREIGN KEY (order_id) REFERENCES dbo.purchase_orders(id) ON DELETE CASCADE,
        CONSTRAINT FK_pol_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'receiving_challans')
BEGIN
    CREATE TABLE dbo.receiving_challans (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_receiving_challans PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NOT NULL,
        supplier_code   VARCHAR(40) NOT NULL,
        purchase_order_id BIGINT    NULL,
        reference       NVARCHAR(200) NULL,
        status          VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVOICED','CANCELLED')),
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_rc_no UNIQUE (doc_no),
        CONSTRAINT FK_rc_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_rc_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_rc_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_rc_supplier FOREIGN KEY (supplier_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_rc_po FOREIGN KEY (purchase_order_id) REFERENCES dbo.purchase_orders(id),
        CONSTRAINT FK_rc_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'receiving_challan_lines')
BEGIN
    CREATE TABLE dbo.receiving_challan_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_receiving_challan_lines PRIMARY KEY,
        challan_id      BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        invoiced_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT UQ_rcl UNIQUE (challan_id, line_no),
        CONSTRAINT FK_rcl_challan FOREIGN KEY (challan_id) REFERENCES dbo.receiving_challans(id) ON DELETE CASCADE,
        CONSTRAINT FK_rcl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_invoices')
BEGIN
    CREATE TABLE dbo.purchase_invoices (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_invoices PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NULL,
        supplier_code   VARCHAR(40) NOT NULL,
        supplier_invoice_no NVARCHAR(100) NOT NULL,
        credit_days     INT         NOT NULL DEFAULT 0,
        reference       NVARCHAR(200) NULL,
        subtotal        DECIMAL(18,2) NOT NULL,
        tax_total       DECIMAL(18,2) NOT NULL DEFAULT 0,
        grand_total     DECIMAL(18,2) NOT NULL,
        is_direct        BIT         NOT NULL DEFAULT 0,
        is_returned_all  BIT         NOT NULL DEFAULT 0,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_pi_no UNIQUE (doc_no),
        CONSTRAINT UQ_pi_supplier_inv UNIQUE (supplier_code, supplier_invoice_no),
        CONSTRAINT FK_pi_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_pi_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_pi_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_pi_supplier FOREIGN KEY (supplier_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_pi_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CHECK (grand_total = subtotal + tax_total)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_invoice_lines')
BEGIN
    CREATE TABLE dbo.purchase_invoice_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_purchase_invoice_lines PRIMARY KEY,
        invoice_id      BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        tax_pct         DECIMAL(7,4) NOT NULL DEFAULT 0,
        line_amount     DECIMAL(18,2) NOT NULL,
        line_tax        DECIMAL(18,2) NOT NULL DEFAULT 0,
        challan_rate    DECIMAL(18,4) NOT NULL,
        receiving_challan_id BIGINT NULL,
        receiving_challan_line_id BIGINT NULL,
        returned_qty    DECIMAL(18,4) NOT NULL DEFAULT 0,
        CONSTRAINT UQ_pil UNIQUE (invoice_id, line_no),
        CONSTRAINT FK_pil_invoice FOREIGN KEY (invoice_id) REFERENCES dbo.purchase_invoices(id) ON DELETE CASCADE,
        CONSTRAINT FK_pil_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_pil_rcl FOREIGN KEY (receiving_challan_line_id) REFERENCES dbo.receiving_challan_lines(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'debit_notes')
BEGIN
    CREATE TABLE dbo.debit_notes (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_debit_notes PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NOT NULL,
        supplier_code   VARCHAR(40) NOT NULL,
        original_invoice_id BIGINT  NOT NULL,
        subtotal        DECIMAL(18,2) NOT NULL,
        tax_total       DECIMAL(18,2) NOT NULL DEFAULT 0,
        grand_total     DECIMAL(18,2) NOT NULL,
        reason          NVARCHAR(500) NULL,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_dn_no UNIQUE (doc_no),
        CONSTRAINT FK_dn_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_dn_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_dn_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_dn_supplier FOREIGN KEY (supplier_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_dn_invoice FOREIGN KEY (original_invoice_id) REFERENCES dbo.purchase_invoices(id),
        CONSTRAINT FK_dn_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CHECK (grand_total = subtotal + tax_total)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'debit_note_lines')
BEGIN
    CREATE TABLE dbo.debit_note_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_debit_note_lines PRIMARY KEY,
        debit_note_id   BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        rate            DECIMAL(18,4) NOT NULL,
        tax_pct         DECIMAL(7,4) NOT NULL DEFAULT 0,
        line_amount     DECIMAL(18,2) NOT NULL,
        line_tax        DECIMAL(18,2) NOT NULL DEFAULT 0,
        original_invoice_line_id BIGINT NOT NULL,
        avg_cost_at_return DECIMAL(18,4) NOT NULL,
        CONSTRAINT UQ_dnl UNIQUE (debit_note_id, line_no),
        CONSTRAINT FK_dnl_dn FOREIGN KEY (debit_note_id) REFERENCES dbo.debit_notes(id) ON DELETE CASCADE,
        CONSTRAINT FK_dnl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_dnl_invoice_line FOREIGN KEY (original_invoice_line_id) REFERENCES dbo.purchase_invoice_lines(id)
    );
END
GO

-- ============================================================================
-- 21. Stock moves and adjustments
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stock_moves')
BEGIN
    CREATE TABLE dbo.stock_moves (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_stock_moves PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        from_store_id   INT         NOT NULL,
        to_store_id     INT         NOT NULL,
        reference       NVARCHAR(200) NULL,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_mv_no UNIQUE (doc_no),
        CONSTRAINT FK_mv_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_mv_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_mv_from FOREIGN KEY (from_store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_mv_to FOREIGN KEY (to_store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_mv_user FOREIGN KEY (created_by) REFERENCES dbo.users(id),
        CHECK (from_store_id <> to_store_id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stock_adjustments')
BEGIN
    CREATE TABLE dbo.stock_adjustments (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_stock_adjustments PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NOT NULL,
        reference       NVARCHAR(200) NULL,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_sa_no UNIQUE (doc_no),
        CONSTRAINT FK_sa_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_sa_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_sa_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_sa_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stock_adjustment_lines')
BEGIN
    CREATE TABLE dbo.stock_adjustment_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_stock_adjustment_lines PRIMARY KEY,
        adjustment_id   BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        system_qty      DECIMAL(18,4) NOT NULL,
        physical_qty    DECIMAL(18,4) NOT NULL,
        difference      DECIMAL(18,4) NOT NULL,
        reason          NVARCHAR(500) NOT NULL,
        avg_cost_at_post DECIMAL(18,4) NOT NULL,
        CONSTRAINT UQ_sal UNIQUE (adjustment_id, line_no),
        CONSTRAINT FK_sal_adj FOREIGN KEY (adjustment_id) REFERENCES dbo.stock_adjustments(id) ON DELETE CASCADE,
        CONSTRAINT FK_sal_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'stock_move_lines')
BEGIN
    CREATE TABLE dbo.stock_move_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_stock_move_lines PRIMARY KEY,
        move_id         BIGINT       NOT NULL,
        line_no         INT          NOT NULL,
        product_id      INT          NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        avg_cost_at_post DECIMAL(18,4) NOT NULL,
        CONSTRAINT UQ_mvl UNIQUE (move_id, line_no),
        CONSTRAINT FK_mvl_move FOREIGN KEY (move_id) REFERENCES dbo.stock_moves(id) ON DELETE CASCADE,
        CONSTRAINT FK_mvl_product FOREIGN KEY (product_id) REFERENCES dbo.products(id)
    );
END
GO

-- ============================================================================
-- 22. Bank reconciliation
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'bank_reconciliations')
BEGIN
    CREATE TABLE dbo.bank_reconciliations (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bank_reconciliations PRIMARY KEY,
        bank_account_code VARCHAR(40) NOT NULL,
        statement_date  DATE        NOT NULL,
        opening_balance  DECIMAL(18,2) NOT NULL,
        closing_balance  DECIMAL(18,2) NOT NULL,
        reconciled_balance DECIMAL(18,2) NOT NULL,
        difference      DECIMAL(18,2) NOT NULL,
        created_by      INT          NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_br_bank FOREIGN KEY (bank_account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_br_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'bank_reconciliation_lines')
BEGIN
    CREATE TABLE dbo.bank_reconciliation_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bank_reconciliation_lines PRIMARY KEY,
        reconciliation_id BIGINT     NOT NULL,
        gl_entry_id     BIGINT      NOT NULL,
        is_tick          BIT         NOT NULL DEFAULT 1,
        CONSTRAINT FK_brl_br FOREIGN KEY (reconciliation_id) REFERENCES dbo.bank_reconciliations(id) ON DELETE CASCADE,
        CONSTRAINT FK_brl_gl FOREIGN KEY (gl_entry_id) REFERENCES dbo.gl_entries(id)
    );
END
GO

-- ============================================================================
-- 23. Opening balances and opening stock
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'opening_balances')
BEGIN
    CREATE TABLE dbo.opening_balances (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_opening_balances PRIMARY KEY,
        branch_id       INT          NOT NULL,
        account_code    VARCHAR(40)  NOT NULL,
        debit           DECIMAL(18,2) NOT NULL DEFAULT 0,
        credit          DECIMAL(18,2) NOT NULL DEFAULT 0,
        fy_start_date   DATE        NOT NULL,
        bill_id         BIGINT       NULL,
        CONSTRAINT UQ_ob_branch_account UNIQUE (branch_id, account_code),
        CONSTRAINT FK_ob_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_ob_account FOREIGN KEY (account_code) REFERENCES dbo.accounts(code),
        CONSTRAINT FK_ob_bill FOREIGN KEY (bill_id) REFERENCES dbo.bills(id),
        CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0) OR (debit = 0 AND credit = 0))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'opening_stock_lines')
BEGIN
    CREATE TABLE dbo.opening_stock_lines (
        id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_opening_stock_lines PRIMARY KEY,
        doc_no          VARCHAR(40)  NOT NULL,
        doc_date        DATE        NOT NULL,
        fiscal_year_id  INT         NOT NULL,
        branch_id       INT         NOT NULL,
        store_id        INT         NOT NULL,
        product_id      INT         NOT NULL,
        quantity        DECIMAL(18,4) NOT NULL,
        cost_price      DECIMAL(18,4) NULL,
        sales_price     DECIMAL(18,4) NULL,
        wholesale_price DECIMAL(18,4) NULL,
        resale_price    DECIMAL(18,4) NULL,
        created_by      INT         NOT NULL,
        created_at      DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
        row_version     ROWVERSION NOT NULL,
        CONSTRAINT UQ_os_no UNIQUE (doc_no),
        CONSTRAINT FK_os_fy FOREIGN KEY (fiscal_year_id) REFERENCES dbo.fiscal_years(id),
        CONSTRAINT FK_os_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(id),
        CONSTRAINT FK_os_store FOREIGN KEY (store_id) REFERENCES dbo.stores(id),
        CONSTRAINT FK_os_product FOREIGN KEY (product_id) REFERENCES dbo.products(id),
        CONSTRAINT FK_os_user FOREIGN KEY (created_by) REFERENCES dbo.users(id)
    );
END
GO

-- ============================================================================
-- 24. Migration tracking
-- ============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '_migrations')
BEGIN
    CREATE TABLE dbo._migrations (
        id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK__migrations PRIMARY KEY,
        script_name     VARCHAR(200) NOT NULL,
        applied_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_migrations_script UNIQUE (script_name)
    );
END
GO

-- ============================================================================
-- 25. TRIGGERS — enforce invariants in the database
-- ============================================================================

-- 25.1 Opening balances must balance per branch
CREATE OR ALTER TRIGGER dbo.TRG_opening_balanced
ON dbo.opening_balances
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT branch_id, SUM(debit) AS d, SUM(credit) AS c
            FROM dbo.opening_balances
            GROUP BY branch_id
        ) x
        WHERE ABS(d - c) > 0.01
    )
    BEGIN
        RAISERROR('Opening balances must be balanced per branch (total debit = total credit).', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO

-- 25.2 Voucher lines balanced per voucher
CREATE OR ALTER TRIGGER dbo.TRG_voucher_lines_balanced
ON dbo.voucher_lines
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    IF EXISTS (
        SELECT x.voucher_id
        FROM (
            SELECT voucher_id, SUM(debit) AS d, SUM(credit) AS c
            FROM dbo.voucher_lines
            WHERE voucher_id IN (SELECT voucher_id FROM inserted)
               OR voucher_id IN (SELECT voucher_id FROM deleted)
            GROUP BY voucher_id
        ) x
        WHERE ABS(x.d - x.c) > 0.01
    )
    BEGIN
        RAISERROR('Voucher lines must be balanced: total debit = total credit.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO

-- 25.3 GL entries balanced per voucher
CREATE OR ALTER TRIGGER dbo.TRG_gl_voucher_balanced
ON dbo.gl_entries
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;

    IF EXISTS (
        SELECT x.voucher_id
        FROM (
            SELECT voucher_id, SUM(debit) AS d, SUM(credit) AS c
            FROM dbo.gl_entries
            WHERE voucher_id IS NOT NULL
              AND (
                  voucher_id IN (SELECT voucher_id FROM inserted WHERE voucher_id IS NOT NULL)
                  OR voucher_id IN (SELECT voucher_id FROM deleted WHERE voucher_id IS NOT NULL)
              )
            GROUP BY voucher_id
        ) x
        WHERE ABS(x.d - x.c) > 0.01
    )
    BEGIN
        RAISERROR('GL entries for a voucher must be balanced: total debit = total credit.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO

-- 25.4 Negative stock block when settings.disallow
CREATE OR ALTER TRIGGER dbo.TRG_stock_balances_nonneg
ON dbo.stock_balances
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM dbo.settings WHERE id = 1 AND allow_negative_stock = 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM inserted WHERE quantity < -0.0001)
        BEGIN
            RAISERROR('Negative stock is not allowed. Adjust the system quantity or allow negative stock in settings.', 16, 1);
            ROLLBACK TRANSACTION;
            RETURN;
        END
    END
END
GO

-- 25.5 At least one admin must always exist
CREATE OR ALTER TRIGGER dbo.TRG_users_keep_admin
ON dbo.users
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE is_active = 1 AND is_admin = 1)
    BEGIN
        RAISERROR('At least one active admin must always exist.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO

-- 25.6 Settings: company_name/company_id immutable from app
CREATE OR ALTER TRIGGER dbo.TRG_settings_protect_company
ON dbo.settings
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON i.id = d.id
        WHERE i.company_name <> d.company_name
           OR i.company_id <> d.company_id
    )
    BEGIN
        RAISERROR('Company name and company ID are immutable from the application. Change them directly in the database if absolutely required.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
    UPDATE s SET updated_at = SYSUTCDATETIME()
    FROM dbo.settings s
    JOIN inserted i ON i.id = s.id;
END
GO

-- 25.7 Cannot post to a group account
CREATE OR ALTER TRIGGER dbo.TRG_accounts_rules
ON dbo.gl_entries
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 1 RETURN;
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.accounts a ON a.code = i.account_code
        WHERE a.is_group = 1
    )
    BEGIN
        RAISERROR('Cannot post to a group account. Only posting accounts accept ledger entries.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.accounts a ON a.code = i.account_code
        WHERE a.is_active = 0
    )
    BEGIN
        RAISERROR('Cannot post to an inactive account. Activate the account first.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO

-- 25.8 Bill settled_amount cannot exceed net_amount
CREATE OR ALTER TRIGGER dbo.TRG_bills_settled_limit
ON dbo.bills
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM inserted
        WHERE settled_amount > net_amount + 0.01
    )
    BEGIN
        RAISERROR('Bill settled amount cannot exceed net amount.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END
GO

-- 25.9 Audit log is append-only
CREATE OR ALTER TRIGGER dbo.TRG_audit_no_update
ON dbo.audit_log
INSTEAD OF UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    RAISERROR('audit_log is append-only; UPDATE and DELETE are not permitted.', 16, 1);
    ROLLBACK TRANSACTION;
END
GO

PRINT '001_schema.sql applied successfully.';
GO
