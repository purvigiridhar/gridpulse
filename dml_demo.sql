USE gridpulse_db;

-- DELETE demonstration
-- Insert a temporary record, delete it, then restore database state
START TRANSACTION;

INSERT INTO node_load_snapshots (node_id, load_percentage)
VALUES (1, 45.00);

SET @demo_id = LAST_INSERT_ID();

DELETE FROM node_load_snapshots
WHERE snapshot_id = @demo_id;

SELECT ROW_COUNT() AS deleted_rows;

ROLLBACK;

-- HAVING demonstration
SELECT
    seller_meter_id,
    COUNT(*) AS total_trades,
    SUM(units_kwh) AS total_energy_sold,
    SUM(total_amount) AS total_revenue
FROM energy_trades
WHERE trade_status = 'COMPLETED'
GROUP BY seller_meter_id
HAVING SUM(units_kwh) > 10
ORDER BY total_revenue DESC;