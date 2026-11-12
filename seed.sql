-- =====================================================================
-- GridPulse seed data. Run AFTER schema.sql:
--   mysql -u root -p < seed.sql
-- All sample accounts use the password:  password123
-- (bcrypt, cost 10). Change these before any non-local deployment.
-- =====================================================================
USE gridpulse_db;

START TRANSACTION;

-- 1. Grid nodes
INSERT INTO grid_nodes (node_name, location_zone, max_capacity_kw, current_tariff_per_kwh) VALUES
('Indiranagar Substation Alpha', 'Zone 1 - East',  100.00, 5.00),
('Koramangala Node Beta',        'Zone 2 - South', 150.00, 5.00);

-- 2. Users
INSERT INTO users (full_name, email, password_hash, user_role) VALUES
('Grid System Admin', 'admin@gridpulse.io', '$2b$10$QyXprCcGzHMmZ6QiGbJn0ux7RUFFltcQ7kcjZgeX4/drPBpv6SIdS', 'ADMIN'),
('Rajesh Kumar',      'rajesh@gmail.com',   '$2b$10$QyXprCcGzHMmZ6QiGbJn0ux7RUFFltcQ7kcjZgeX4/drPBpv6SIdS', 'PROSUMER'),
('Ananya Sen',        'ananya@gmail.com',   '$2b$10$QyXprCcGzHMmZ6QiGbJn0ux7RUFFltcQ7kcjZgeX4/drPBpv6SIdS', 'PROSUMER'),
('Vikram Rao',        'vikram@gmail.com',   '$2b$10$QyXprCcGzHMmZ6QiGbJn0ux7RUFFltcQ7kcjZgeX4/drPBpv6SIdS', 'PROSUMER');

-- 3. Smart meters (resolved by email so IDs needn't be hard-coded)
INSERT INTO smart_meters (meter_id, user_id, node_id, installation_address)
SELECT 'MTR-IND-001', u.user_id, n.node_id, '452 10th Main, Indiranagar, Bengaluru'
  FROM users u, grid_nodes n WHERE u.email = 'rajesh@gmail.com' AND n.node_name = 'Indiranagar Substation Alpha';
INSERT INTO smart_meters (meter_id, user_id, node_id, installation_address)
SELECT 'MTR-IND-002', u.user_id, n.node_id, '78 4th Cross, Indiranagar, Bengaluru'
  FROM users u, grid_nodes n WHERE u.email = 'ananya@gmail.com' AND n.node_name = 'Indiranagar Substation Alpha';
INSERT INTO smart_meters (meter_id, user_id, node_id, installation_address)
SELECT 'MTR-KOR-003', u.user_id, n.node_id, '12 5th Block, Koramangala, Bengaluru'
  FROM users u, grid_nodes n WHERE u.email = 'vikram@gmail.com' AND n.node_name = 'Koramangala Node Beta';

-- 4. Wallets (admin has none: not a trading participant)
INSERT INTO wallets (user_id, balance_inr)
SELECT user_id, 2500.00 FROM users WHERE email = 'rajesh@gmail.com';
INSERT INTO wallets (user_id, balance_inr)
SELECT user_id, 1800.00 FROM users WHERE email = 'ananya@gmail.com';
INSERT INTO wallets (user_id, balance_inr)
SELECT user_id, 3200.00 FROM users WHERE email = 'vikram@gmail.com';

-- 5. One historical trade so the analytics view has data
--    (inserted directly; wallet balances above already reflect it as "current")
INSERT INTO energy_trades (seller_meter_id, buyer_meter_id, units_kwh, rate_per_kwh, total_amount, trade_status)
VALUES ('MTR-IND-001', 'MTR-IND-002', 15.50, 5.00, 77.50, 'COMPLETED');
-- Update
UPDATE smart_meters
SET meter_type = 'SOLAR'
WHERE meter_id IN ('MTR-IND-001','MTR-KOR-003');

COMMIT;
