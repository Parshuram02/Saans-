# 📱 BreathAhead — Twilio SMS Early Warning System Plan

### 🎯 Objective
Connect **BreathAhead's** smoke transport intelligence to **Twilio SMS** so that schools, parents, and citizens receive pre-emptive phone alerts **12–24 hours before** upwind stubble smoke arrives in their Delhi sector.

---

### 🔑 1. Setup & Environment Variables
In the project root `.env` file, add the Twilio credentials:
```env
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
```

Install the Twilio Python SDK:
```bash
pip install twilio
```

---

### 📦 2. Backend Module: `core/alerts.py`
Create a helper script in `core/alerts.py` to format and dispatch SMS based on user role and sector threat:

```python
import os
from twilio.rest import Client

TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_FROM = os.getenv("TWILIO_PHONE_NUMBER")

def send_smoke_alert_sms(
    to_phone: str,
    sector_name: str,
    role: str,
    threat_level: str,
    eta_hours: float,
    upwind_fires: int
):
    """
    Dispatches tailored SMS alerts via Twilio based on recipient persona and threat level.
    """
    if not TWILIO_SID or not TWILIO_AUTH or not TWILIO_FROM:
        raise ValueError("Missing Twilio credentials in environment (.env).")

    client = Client(TWILIO_SID, TWILIO_AUTH)
    eta_str = f"~{int(eta_hours)}h" if eta_hours is not None else "N/A"
    
    # Dynamic SMS Templates based on recipient role
    if role == "school":
        if threat_level == "HIGH":
            body = (
                f"🚨 [BreathAhead CODE RED] {sector_name}: Stubble smoke from {upwind_fires} fires "
                f"arriving in {eta_str}. Advisory: Suspend morning outdoor assembly, move PE indoors, "
                f"shift Classes 1-5 to hybrid. Details: breathahead.app"
            )
        else:
            body = (
                f"⚠️ [BreathAhead Advisory] {sector_name}: Moderate smoke influx in {eta_str}. "
                f"Pre-action: Move morning assembly indoors; exempt sensitive students from outdoor PE."
            )
    elif role == "parent":
        body = (
            f"🏠 [BreathAhead Advisory] {sector_name}: Farm fire plume arriving in {eta_str}. "
            f"Action: Seal NW windows by 8 PM, run air purifier 2h prior to arrival. "
            f"Keep asthmatic inhalers ready."
        )
    else:  # general citizen / outdoor worker
        body = (
            f"😷 [BreathAhead Alert] {sector_name}: Threat Level: {threat_level} (ETA {eta_str}). "
            f"Mandatory N95 masks for outdoor commute/shifts. Cap outdoor exertion to <45 mins."
        )

    message = client.messages.create(
        body=body,
        from_=TWILIO_FROM,
        to=to_phone
    )
    return {"status": "sent", "sid": message.sid, "body": body}
```

---

### ⚡ 3. API Endpoint / Handler
Add an endpoint in `backend/api/handler.py` (or a local script `scripts/send_sms.py`):
- **Method**: `POST /alerts/send`
- **Request Body**:
  ```json
  {
    "phone": "+919876543210",
    "sector": "East Delhi (Anand Vihar)",
    "role": "school",
    "threat_level": "HIGH",
    "eta_hours": 12,
    "upwind_fires": 54
  }
  ```
- **Response**:
  ```json
  {
    "ok": true,
    "sid": "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "message": "SMS dispatched successfully."
  }
  ```

---

### 🖥️ 4. Frontend UI Widget (`web/index.html` & `web/app.js`)
Add a simple **"📲 Subscribe / Test SMS Alert"** card under the Protection Playbook:
1. **Inputs**:
   - Phone Number input box (`<input type="tel" id="input-alert-phone" placeholder="+91 98765 43210">`)
   - Role Selector dropdown: `🏫 School Principal`, `👨‍👩‍👧 Parent`, `😷 Citizen`
   - Sector: Automatically pre-filled with the active selected sector (e.g. *Anand Vihar*)
2. **Button**: `[ Send Early-Warning SMS ]`
3. **On Click**:
   - Sends a `POST` request to the backend.
   - Shows a success toast notification: *"✅ Alert SMS sent to +91 98765 43210 for Anand Vihar (ETA ~12h)"*.

---

### 🧪 5. Quick CLI Test Script (`scripts/test_sms.py`)
```python
import argparse
import os
from dotenv import load_dotenv
from core.alerts import send_smoke_alert_sms

load_dotenv()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Twilio SMS for BreathAhead")
    parser.add_argument("--phone", required=True, help="Recipient phone with country code (e.g. +919876543210)")
    parser.add_argument("--sector", default="East Delhi (Anand Vihar)", help="Delhi sector name")
    parser.add_argument("--role", default="school", choices=["school", "parent", "citizen"], help="Target role")
    parser.add_argument("--threat", default="HIGH", choices=["HIGH", "MODERATE", "LOW"], help="Threat level")
    parser.add_argument("--eta", type=float, default=12.0, help="Arrival ETA in hours")
    parser.add_argument("--fires", type=int, default=54, help="Upwind fire count")
    
    args = parser.parse_args()
    
    res = send_smoke_alert_sms(
        to_phone=args.phone,
        sector_name=args.sector,
        role=args.role,
        threat_level=args.threat,
        eta_hours=args.eta,
        upwind_fires=args.fires
    )
    print("Success:", res)
```

---

### 💡 Hackathon Demo Tips
1. **Twilio Free Trial Accounts**: Can only send SMS to **Verified Numbers** registered in the Twilio Console. Add your teammates' phone numbers to the verified caller IDs before judging.
2. **Frontend Offline Fallback**: Include a fallback in JavaScript so that if API keys are missing or offline during the pitch, the UI renders a simulated on-screen phone notification mockup to demonstrate the exact SMS content to the judges without breaking the demo flow.
