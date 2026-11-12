-- =====================================================================
-- GridPulse: MySQL 8.0.16+ schema
-- Load with the mysql CLI (the DELIMITER lines are CLI-only syntax):
--   mysql -u root -p < schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS gridpulse_db
    CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE gridpulse_db;

-- ---------------------------------------------------------------------
-- Table 1: Infrastructure grid nodes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grid_nodes (
    node_id                INT AUTO_INCREMENT PRIMARY KEY,
    node_name              VARCHAR(100)  NOT NULL UNIQUE,
    location_zone          VARCHAR(100)  NOT NULL,
    max_capacity_kw        DECIMAL(10,2) NOT NULL,
    current_load_kw        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    current_tariff_per_kwh DECIMAL(6,2)  NOT NULL DEFAULT 5.00,
    created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_node_capacity CHECK (max_capacity_kw > 0),
    CONSTRAINT chk_node_load     CHECK (current_load_kw >= 0),
    CONSTRAINT chk_node_tariff   CHECK (current_tariff_per_kwh > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table 2: Users (role-based; password stored as bcrypt hash)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    user_role     ENUM('ADMIN','PROSUMER') NOT NULL DEFAULT 'PROSUMER',
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table 3: Household smart meters
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smart_meters (
    meter_id             VARCHAR(50) PRIMARY KEY,
    user_id              INT  NOT NULL,
    node_id              INT  NOT NULL,
    installation_address TEXT NOT NULL,
    is_active            BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_meter_user FOREIGN KEY (user_id) REFERENCES users(user_id)      ON DELETE CASCADE,
    CONSTRAINT fk_meter_node FOREIGN KEY (node_id) REFERENCES grid_nodes(node_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table 4: Financial wallets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
    wallet_id   INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL UNIQUE,
    balance_inr DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_wallet_balance CHECK (balance_inr >= 0),
    CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table 5: Node load snapshots (bridge from MongoDB aggregation)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_load_snapshots (
    snapshot_id     INT AUTO_INCREMENT PRIMARY KEY,
    node_id         INT NOT NULL,
    load_percentage DECIMAL(5,2) NOT NULL,
    recorded_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_load_pct CHECK (load_percentage BETWEEN 0 AND 100),
    CONSTRAINT fk_snapshot_node FOREIGN KEY (node_id) REFERENCES grid_nodes(node_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Table 6: P2P energy trades (financial ledger)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS energy_trades (
    trade_id        INT AUTO_INCREMENT PRIMARY KEY,
    seller_meter_id VARCHAR(50)   NOT NULL,
    buyer_meter_id  VARCHAR(50)   NOT NULL,
    units_kwh       DECIMAL(8,2)  NOT NULL,
    rate_per_kwh    DECIMAL(6,2)  NOT NULL,
    total_amount    DECIMAL(10,2) NOT NULL,
    trade_status    ENUM('PENDING','COMPLETED','FAILED') NOT NULL DEFAULT 'COMPLETED',
    traded_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_trade_units  CHECK (units_kwh > 0),
    CONSTRAINT chk_trade_rate   CHECK (rate_per_kwh > 0),
    CONSTRAINT chk_trade_total  CHECK (total_amount > 0),
    CONSTRAINT chk_different_meters CHECK (seller_meter_id <> buyer_meter_id),
    CONSTRAINT fk_trade_seller FOREIGN KEY (seller_meter_id) REFERENCES smart_meters(meter_id),
    CONSTRAINT fk_trade_buyer  FOREIGN KEY (buyer_meter_id)  REFERENCES smart_meters(meter_id)
) ENGINE=InnoDB;



-- Alter --
-- ALTER TABLE demonstrations

ALTER TABLE smart_meters
ADD COLUMN meter_type ENUM('CONSUMER','SOLAR','BATTERY')
NOT NULL DEFAULT 'CONSUMER'
AFTER node_id;

ALTER TABLE users
ADD CONSTRAINT chk_user_email
CHECK (email LIKE '_%@_%.__%');

ALTER TABLE smart_meters
ADD FULLTEXT INDEX ft_meter_address (installation_address);



--------------------------------------------------------------------
-- Performance indexes
-- ---------------------------------------------------------------------
CREATE INDEX idx_smart_meters_node     ON smart_meters(node_id);
CREATE INDEX idx_smart_meters_user     ON smart_meters(user_id);
CREATE INDEX idx_trades_seller_buyer   ON energy_trades(seller_meter_id, buyer_meter_id);
CREATE INDEX idx_trades_buyer          ON energy_trades(buyer_meter_id);
CREATE INDEX idx_trades_timestamp      ON energy_trades(traded_at);
CREATE INDEX idx_snapshots_node_time   ON node_load_snapshots(node_id, recorded_at);

-- ---------------------------------------------------------------------
-- View: weekly executive analytics (per node, by seller side)
-- The 7-day / COMPLETED filter lives in the JOIN condition so that nodes
-- with no recent trades still appear with zeroed metrics.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_weekly_grid_analytics AS
SELECT
    gn.node_id,
    gn.node_name,
    COUNT(et.trade_id)                 AS total_trades,
    COALESCE(SUM(et.units_kwh), 0)     AS total_kwh_traded,
    COALESCE(SUM(et.total_amount), 0)  AS total_revenue_inr,
    COALESCE(AVG(et.rate_per_kwh), 0)  AS avg_trade_rate
FROM grid_nodes gn
LEFT JOIN smart_meters sm
       ON sm.node_id = gn.node_id
LEFT JOIN energy_trades et
       ON et.seller_meter_id = sm.meter_id
      AND et.trade_status = 'COMPLETED'
      AND et.traded_at >= NOW() - INTERVAL 7 DAY
GROUP BY gn.node_id, gn.node_name;

-- ---------------------------------------------------------------------
-- Trigger: dynamic surge pricing
--   load >= 80%  -> surge tariff (base * 1.25)
--   load <  50%  -> reset to base tariff
--   50-80%       -> tariff unchanged
-- Surge is computed from the base rate (not the current rate), so repeated
-- high-load snapshots cannot compound the tariff indefinitely.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_dynamic_surge_pricing;
DELIMITER //
CREATE TRIGGER trg_dynamic_surge_pricing
AFTER INSERT ON node_load_snapshots
FOR EACH ROW
BEGIN
    DECLARE c_base_tariff  DECIMAL(6,2) DEFAULT 5.00;
    DECLARE c_surge_factor DECIMAL(4,2) DEFAULT 1.25;

    IF NEW.load_percentage >= 80.00 THEN
        UPDATE grid_nodes
           SET current_tariff_per_kwh = ROUND(c_base_tariff * c_surge_factor, 2)
         WHERE node_id = NEW.node_id;
    ELSEIF NEW.load_percentage < 50.00 THEN
        UPDATE grid_nodes
           SET current_tariff_per_kwh = c_base_tariff
         WHERE node_id = NEW.node_id;
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- Stored procedure: atomic P2P energy trade
-- Returns one row: trade_id, rate_per_kwh, total_amount.
-- Errors (SQLSTATE 45000) are raised for invalid input, unknown/inactive
-- meters, self-trades, missing wallets and insufficient balance.
-- Wallet rows are locked in user_id order to avoid deadlocks between
-- concurrent opposite-direction trades.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_execute_energy_trade;
DELIMITER //
CREATE PROCEDURE sp_execute_energy_trade(
    IN p_seller_meter VARCHAR(50),
    IN p_buyer_meter  VARCHAR(50),
    IN p_units        DECIMAL(8,2)
)
BEGIN
    DECLARE v_seller_user    INT;
    DECLARE v_buyer_user     INT;
    DECLARE v_seller_active  BOOLEAN;
    DECLARE v_buyer_active   BOOLEAN;
    DECLARE v_node           INT;
    DECLARE v_rate           DECIMAL(6,2);
    DECLARE v_total          DECIMAL(10,2);
    DECLARE v_buyer_balance  DECIMAL(12,2);
    DECLARE v_first_user     INT;
    DECLARE v_second_user    INT;
    DECLARE v_locked_wallets INT DEFAULT 0;
    DECLARE v_trade_id       INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    -- Input validation (before opening a transaction)
    IF p_units IS NULL OR p_units <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Units must be greater than zero.';
    END IF;
    IF p_seller_meter = p_buyer_meter THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seller and buyer meters must differ.';
    END IF;

    START TRANSACTION;

    SELECT user_id, node_id, is_active
      INTO v_seller_user, v_node, v_seller_active
      FROM smart_meters WHERE meter_id = p_seller_meter;

    SELECT user_id, is_active
      INTO v_buyer_user, v_buyer_active
      FROM smart_meters WHERE meter_id = p_buyer_meter;

    IF v_seller_user IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seller meter not found.';
    END IF;
    IF v_buyer_user IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Buyer meter not found.';
    END IF;
    IF NOT v_seller_active OR NOT v_buyer_active THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Both meters must be active.';
    END IF;

    -- Rate is the seller node's current (possibly surge) tariff
    SELECT current_tariff_per_kwh INTO v_rate
      FROM grid_nodes WHERE node_id = v_node;
    SET v_total = ROUND(p_units * v_rate, 2);

    -- Lock both wallets in a deterministic order
    SET v_first_user  = LEAST(v_seller_user, v_buyer_user);
    SET v_second_user = GREATEST(v_seller_user, v_buyer_user);

    SELECT COUNT(*) INTO v_locked_wallets FROM (
        SELECT wallet_id FROM wallets
         WHERE user_id IN (v_first_user, v_second_user)
         ORDER BY user_id
         FOR UPDATE
    ) AS locked;

    IF v_seller_user = v_buyer_user THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Cannot trade between meters of the same user.';
    END IF;
    IF v_locked_wallets < 2 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Seller or buyer wallet not found.';
    END IF;

    SELECT balance_inr INTO v_buyer_balance
      FROM wallets WHERE user_id = v_buyer_user;

    IF v_buyer_balance < v_total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient buyer wallet balance.';
    END IF;

    UPDATE wallets SET balance_inr = balance_inr - v_total WHERE user_id = v_buyer_user;
    UPDATE wallets SET balance_inr = balance_inr + v_total WHERE user_id = v_seller_user;

    INSERT INTO energy_trades
        (seller_meter_id, buyer_meter_id, units_kwh, rate_per_kwh, total_amount, trade_status)
    VALUES
        (p_seller_meter, p_buyer_meter, p_units, v_rate, v_total, 'COMPLETED');

    SET v_trade_id = LAST_INSERT_ID();

    COMMIT;

    SELECT v_trade_id AS trade_id, v_rate AS rate_per_kwh, v_total AS total_amount;
END //
DELIMITER ;
