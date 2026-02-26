import asyncio
import logging
from backend.core.nse_client import NSEClient

logging.basicConfig(level=logging.INFO)

async def test_nse_corp_actions():
    client = NSEClient()
    try:
        symbol = "RELIANCE"
        print("Testing corp_info section...")
        corp_info = await client.get_corp_info(symbol)
        if isinstance(corp_info, dict) and "data" in corp_info:
             data = corp_info["data"]
             print(f"Data keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
             if isinstance(data, dict) and "corporate" in data:
                 print(f"Corporate keys: {list(data['corporate'].keys())}")
                 print(f"Corporate actions: {len(data['corporate'].get('corporateActions', []))}")
                 print(f"Announcements: {len(data['corporate'].get('announcements', []))}")
                 print(f"Board Meetings: {len(data['corporate'].get('boardMeetings', []))}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        await client.close()

if __name__ == "__main__":
    asyncio.run(test_nse_corp_actions())
