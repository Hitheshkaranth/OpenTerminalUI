"""Economic terminal provider and dependency factory."""
from functools import lru_cache
from backend.services.fxmacrodata_economics import FXMacroDataEconomics

EconomicDataService = FXMacroDataEconomics

@lru_cache(maxsize=1)
def get_economic_data_service() -> EconomicDataService:
    return EconomicDataService()
