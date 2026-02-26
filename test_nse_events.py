import asyncio
import logging
from backend.core.nse_client import NSEClient

logging.basicConfig(level=logging.INFO)

async def test_nse_corp_actions():
    client = NSEClient()
    try:
        # Test the endpoint used in corporate_actions.py
        symbol = "RELIANCE"
        print(f"Testing NSE corporate actions for {symbol}...")
        payload = await client._request(
            "/corporates-corporateActions",
            {"index": "equities", "symbol": symbol.upper()},
        )
        print(f"Payload received (count): {len(payload) if isinstance(payload, list) else 'Not a list'}")

        print("\nTesting corp_info section...")
        corp_info = await client.get_corp_info(symbol)
        print(f"Corp info received keys: {list(corp_info.keys()) if isinstance(corp_info, dict) else 'Not a dict'}")
        if isinstance(corp_info, dict) and "corporate" in corp_info:
             print(f"Corporate actions in corp_info: {len(corp_info['corporate'].get('corporateActions', []))}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(test_nse_corp_actions())
