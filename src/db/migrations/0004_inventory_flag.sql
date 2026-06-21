-- Migration 0004: track whether a discovered page carries its own Bricks
-- content. Pages rendered by shared Bricks templates (no per-post content)
-- return 400/422 from the inventory endpoint; the scenario generator marks
-- them has_inventory=false so later runs skip them automatically. NULL means
-- "not yet checked".

alter table discovered_pages add column if not exists has_inventory boolean;
