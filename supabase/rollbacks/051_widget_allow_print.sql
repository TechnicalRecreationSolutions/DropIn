-- Rollback for 051_widget_allow_print.sql. Clean reverse: the column is a
-- display toggle and nothing else references it.
ALTER TABLE widget_configs DROP COLUMN IF EXISTS allow_print;
