from pathlib import Path

from tally_simple_item_sync import PORTS, SyncConfig, run_with_lock


SHEET_URL = "https://script.google.com/macros/s/AKfycbxj8CyNTDnKH6Jqfeva9H46Yc8G680Vxplk_b62vOA6d3WHXgYrqHMIebktS358RCXi3g/exec?sheet=PHP"
RUN_LOG_URL = "https://script.google.com/macros/s/AKfycbyjfSEykz05oWHamnxp6GayHpvsWaauuAX-NVRM-r2u-D0eLU-xBtbtrzAGJ46Rk20OOg/exec"
LOCK_FILE = Path(__file__).with_suffix(".lock")


CONFIG = SyncConfig(
    sync_name="PHP",
    sheet_url=SHEET_URL,
    parent_group="PLATES AND PARTITION",
    filename=Path(__file__).name,
    run_log_url=RUN_LOG_URL,
    ports=PORTS,
)


if __name__ == "__main__":
    run_with_lock(CONFIG, LOCK_FILE)
