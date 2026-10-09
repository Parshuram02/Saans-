# 🌬️ Saans (साँस) — Stubble Fire Early Warning System

> **Environmental Hacks Hackathon — Track: Air (Module 1)**  
> Early-warning risk scoring and smoke-arrival estimation for Delhi-NCR and the Indo-Gangetic Plains.

## 🚨 Problem

Every post-monsoon autumn, particularly during **October–November**, paddy harvesting across Punjab and Haryana leaves farmers with a narrow **10–14 day window** to prepare their fields for wheat sowing.

Large-scale open-field burning of paddy residue produces significant amounts of smoke and particulate matter. Under suitable meteorological conditions, these smoke plumes can travel toward **Delhi-NCR and other parts of the Indo-Gangetic Plains**, contributing to severe air-quality episodes.

Saans focuses on three practical questions:

1. 🔥 **Where are fires concentrated right now?**
2. 📊 **Which areas have the highest near-term burn risk?**
3. 🌬️ **How long could smoke from upwind fire clusters take to reach Delhi, Ludhiana, or Chandigarh?**

---

## 💡 What Saans Does

Saans Module 1 combines satellite fire detections, historical fire patterns, recent fire activity, and meteorological wind data to produce a transparent early-warning dashboard.

### 🛰️ 1. Satellite Fire Detection

Saans ingests near-real-time thermal anomaly detections from **NASA FIRMS VIIRS**, providing fire detections at approximately **375 m spatial resolution**.

The detections include information such as:

- Latitude and longitude
- Detection timestamp
- Fire Radiative Power (FRP)
- Confidence information
- Satellite source

### 🗺️ 2. Grid-Based Risk Scoring

The region is divided into approximately **0.1° (~10 km) grid cells**.

Each cell receives a transparent risk score based on:

- Historical fire activity around the same period of the season
- Recent fire activity during the previous **48 hours**
- Fire intensity
- Spatial clustering and neighborhood activity

### 🌬️ 3. Upwind Smoke Transport Estimation

For each target city, Saans:

1. Retrieves current/forecast **10 m wind speed and direction**.
2. Determines the approximate upwind region.
3. Identifies fire clusters located in that direction.
4. Uses fire intensity / FRP to weight the clusters.
5. Estimates the approximate travel time to the target city.
6. Assigns a threat level.

### Threat Levels

| Level | Meaning |
|---|---|
| 🟢 **LOW** | Limited upwind fire activity or low estimated impact |
| 🟡 **MODERATE** | Noticeable upwind fire activity |
| 🔴 **HIGH** | Strong upwind fire activity with relatively short estimated arrival |
| ⚪ **STAGNANT** | Wind conditions are too weak for a meaningful transport estimate |

---

## 📢 Headline Intelligence

Instead of forcing users to interpret raw satellite points, Saans generates concise summaries such as:

> **Delhi:** Smoke from **34 upwind fire detections**, estimated arrival in **14 hours**, threat level **HIGH**.

The goal is to make the information understandable to both technical and non-technical users.

---

## 🗺️ Interactive Dashboard

The web interface provides a geospatial view containing:

- 🔥 Satellite fire detections
- 🟧 Grid-based fire-risk cells
- 🌬️ Wind direction indicators
- ➡️ Approximate upwind trajectory links
- 🏙️ Target cities
- 📊 Smoke threat levels
- ⏱️ Estimated smoke arrival times

The map is built using **Leaflet.js** and requires no frontend build system.

---

# 🏗️ Architecture

```text
                         +-------------------------------+
                         |     NASA FIRMS API (VIIRS)    |
                         |       Near-Real-Time Data     |
                         +---------------+---------------+
                                         |
                                         v
+--------------------------+   +-------------------------+
| Open-Meteo Weather API   |-->|      Ingest Lambda      |
|                          |   |                         |
| - 10m wind speed         |   | - Fetch fire data       |
| - 10m wind direction     |   | - Calculate risk        |
| - Forecast data          |   | - Calculate smoke ETA   |
+--------------------------+   +------------+------------+
                                            |
                                            v
                                  +-----------------------+
                                  |    Amazon DynamoDB    |
                                  |                       |
                                  | - RiskCells           |
                                  | - CitySmoke           |
                                  | - Meta                |
                                  +-----------+-----------+
                                              |
                                              v
                                  +-----------------------+
                                  |     API Gateway      |
                                  |       HTTP API        |
                                  +-----------+-----------+
                                              |
                                              v
                                  +-----------------------+
                                  |      API Lambda       |
                                  |                       |
                                  | GET /risk             |
                                  | GET /smoke            |
                                  +-----------+-----------+
                                              |
                                              v
                          +----------------------------------+
                          |          Leaflet Web UI           |
                          |                                  |
                          | HTML5 + CSS + Vanilla JavaScript |
                          +----------------------------------+

        Historical Data
               |
               v
      +-----------------------+
      | Amazon S3             |
      | history_cells.json    |
      +-----------+-----------+
                  |
                  +------------> Ingest Lambda


      +-------------------------+
      | Amazon EventBridge      |
      | Scheduled Trigger       |
      | Every 3 Hours           |
      +------------+------------+
                   |
                   +------------> Ingest Lambda
```

---



#  Deployment: Amazon EC2 + Nginx

Besides the serverless SAM deployment, Saans can run on a single **Amazon EC2** instance, with **Nginx** serving the web dashboard. This is the simplest way to get a public demo online.

```text
User Browser
     |
     v   HTTP (port 80)
+----------------------------+
|  Amazon EC2 (Ubuntu)       |
|                            |
|  Nginx  --> /var/www/saans |
|  (serves index.html,       |
|   app.js, styles.css)      |
|                            |
|  Python venv               |
|  (pipeline scripts)        |
+----------------------------+
```

## What is Nginx?

Nginx is a high-performance web server. It receives HTTP requests from browsers and returns the right file (such as `index.html`). Saans' frontend is static (HTML, CSS, vanilla JavaScript), so Nginx can serve it directly without a build step. Nginx can also act as a reverse proxy if a Python API is added later.

## 1. Launch the EC2 instance

- **AMI:** Ubuntu Server (22.04 or 24.04 LTS)
- **Instance type:** `t2.micro` or `t3.micro` (free-tier eligible)
- **Key pair:** create or select one and keep the `.pem` file safe
- **Security group (inbound rules):**

| Type | Port | Source | Purpose |
|---|---|---|---|
| SSH | 22 | My IP | Admin access |
| HTTP | 80 | 0.0.0.0/0 | Public website |
| HTTPS | 443 | 0.0.0.0/0 | Secure website (optional) |

Outbound rules are left at the default (allow all) so the server can install packages and call the NASA FIRMS and Open-Meteo APIs. Do not expose port 8000 publicly.

## 2. Connect to the instance

```bash
ssh -i /path/to/your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

On Windows, if SSH reports "UNPROTECTED PRIVATE KEY FILE", restrict the key's permissions first:

```cmd
icacls "D:\your-key.pem" /inheritance:r
icacls "D:\your-key.pem" /grant:r "%USERNAME%:R"
```

## 3. Install dependencies and get the code

```bash
sudo apt update && sudo apt install -y python3-pip python3-venv nginx git
git clone <repo-url> saans
cd saans
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # then add FIRMS_MAP_KEY
```

## 4. Publish the web dashboard with Nginx

Copy the static site to Nginx's web root:

```bash
sudo mkdir -p /var/www/saans
sudo cp -r ~/saans/web/* /var/www/saans/
```

Create the site config:

```bash
sudo nano /etc/nginx/sites-available/saans
```

```nginx
server {
    listen 80 default_server;
    server_name _;

    root /var/www/saans;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Enable it and reload Nginx:

```bash
sudo rm /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/saans /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Open `http://<EC2-PUBLIC-IP>` in a browser to see the dashboard.

## 5. Updating the site

Nginx serves the copy in `/var/www/saans`, so re-copy after pulling changes:

```bash
cd ~/saans && git pull
sudo cp -r web/* /var/www/saans/
```

No Nginx reload is needed for static file changes.

## Useful Nginx commands

| Command | Purpose |
|---|---|
| `sudo nginx -t` | Test the configuration for errors |
| `sudo systemctl reload nginx` | Apply config changes without downtime |
| `sudo systemctl restart nginx` | Full restart |
| `sudo systemctl status nginx` | Check whether Nginx is running |
| `sudo tail -f /var/log/nginx/error.log` | Watch error logs live |

## Key Nginx files

| Path | Purpose |
|---|---|
| `/etc/nginx/sites-available/saans` | Site configuration |
| `/etc/nginx/sites-enabled/` | Active sites (symlinks) |
| `/var/www/saans` | Website files |
| `/var/log/nginx/access.log` | Request log |
| `/var/log/nginx/error.log` | Error log |

## Optional: HTTPS and a fixed IP

- Allocate an **Elastic IP** and attach it to the instance, so the address doesn't change when the instance is stopped and started.
- Point a domain to the Elastic IP, set `server_name yourdomain.com;` in the Nginx config, then run:
```bash
  sudo apt install -y certbot python3-certbot-nginx
  sudo certbot --nginx -d yourdomain.com
```

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| SSH: connection timed out | Your public IP changed. Update the SSH rule's source to **My IP** in the security group |
| Site not loading | Check that port 80 is open in the security group, and use `http://` not `https://` |
| 403 Forbidden | `sudo chmod -R 755 /var/www/saans && sudo chown -R www-data:www-data /var/www/saans` |
| 404 Not Found | `index.html` is not directly inside `/var/www/saans`; check with `ls /var/www/saans` |
| Map loads but no data | `API_BASE` in `web/app.js` doesn't point to a working API endpoint |

# 🧮 Risk Scoring Model

Saans intentionally uses a **transparent heuristic model** rather than a black-box machine-learning model.

The risk score combines:

```text
Historical Fire Activity
          +
Recent 48-Hour Fire Activity
          +
Fire Intensity / FRP
          +
Neighborhood Fire Activity
          |
          v
    Final Risk Score
```

This makes the system:

- Easy to explain
- Easy to debug
- Easy to tune
- Suitable for hackathon demonstrations
- Lightweight to run

---

# 🌬️ Smoke Arrival Estimation

For a target city, Saans identifies fire clusters approximately **upwind** of the city.

A simplified first-order estimate is:

```text
Time to Arrival ≈ Distance / Wind Speed
```

Where:

- **Distance** = approximate distance between the fire cluster and target city
- **Wind Speed** = surface wind speed
- **Wind Direction** = determines whether the fire is approximately upwind

Fire clusters are weighted using their estimated intensity, including **Fire Radiative Power (FRP)**.

The simplified process is:

```text
Fire Cluster
     |
     v
Is it Upwind?
     |
     v
Calculate Distance
     |
     v
Apply Wind Speed
     |
     v
Estimate Arrival Time
     |
     v
Assign Threat Level
```

---

# ⚠️ Honest Limitations

Saans is an **early-warning risk scoring and estimation system**, not a full atmospheric chemistry or numerical weather prediction model.

### 1. 🛰️ Satellite Pass Gaps

NASA FIRMS VIIRS satellites do not continuously observe every location.

Fires can occur between satellite overpasses and may therefore not immediately appear in the system.

Cloud cover can also affect detection.

### 2. 📊 Heuristic Risk Model

The risk score combines historical and recent fire activity using transparent mathematical rules.

It is **not a machine-learning prediction model** and does not currently incorporate factors such as:

- Crop economics
- Individual farmer behavior
- Soil conditions
- Harvest machinery availability
- Field-level crop data

### 3. 🌬️ First-Order Smoke Transport

Smoke arrival estimates use surface wind information and simplified straight-line trajectories.

Real atmospheric transport is considerably more complex and depends on:

- Planetary Boundary Layer (PBL) height
- Atmospheric stability
- Temperature inversions
- Wind shear
- Turbulence
- Vertical smoke injection height
- Atmospheric chemistry
- Terrain

Therefore, the ETA should be interpreted as an **approximate early-warning estimate**, not an exact arrival time.

### 4. 🎚️ Tunable Thresholds

Threat levels such as:

```text
LOW
MODERATE
HIGH
STAGNANT
```

are heuristic and can be calibrated using historical observations.

### 5. 🔁 Historical Replay Mode

Stubble-burning activity is strongly seasonal and typically peaks during the post-monsoon harvesting period.

For demonstrations outside the active burning season, Saans supports a **Historical Replay Mode**.

Example:

```bash
python scripts/run_pipeline_local.py --as-of 2024-11-01
```

This allows the system to reproduce conditions from a historical high-burning period.

---

# 🛠️ Technology Stack

## Backend

- Python 3.12
- a Lambda
- Amazon DynamoDB
- Amazon S3
- Amazon EventBridge
- Amazon API Gateway

## Data Sources

- NASA FIRMS VIIRS
- Open-Meteo Weather API

## Frontend

- HTML5
- CSS3
- Vanilla JavaScript
- Leaflet.js



# 🚀 Run Locally

## 1. Prerequisites

Install:

- Python **3.12+**
- Git
- NASA FIRMS API Map Key

Get a free FIRMS Map Key from:

https://firms.modaps.eosdis.nasa.gov/api/map_key/

## 2. Clone the Repository

```bash
git clone <repo-url> saans
cd saans
```

## 3. Install Dependencies

```bash
pip install -r requirements.txt
```

## 4. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Then add your NASA FIRMS Map Key:

```env
FIRMS_MAP_KEY=your_map_key_here
```

---

# 🧪 Run Tests

Using Make:

```bash
make test
```

Or directly with pytest:

```bash
pytest tests/ -v
```

---

# ▶️ Run the Local Pipeline

### Live Mode

Fetch the latest available data:

```bash
make local
```

### Historical Replay

Run the pipeline using historical data:

```bash
python scripts/run_pipeline_local.py --as-of 2024-11-01
```

---

# 🌐 Start the Web Interface

```bash
make serve
```

Then open:

```text
http://localhost:8000
```

---

# ☁️ Deploy to AWS

Saans can be deployed using the **AWS Serverless Application Model (SAM)**.

Navigate to the backend:

```bash
cd backend
```

Build the application:

```bash
sam build
```

Deploy:

```bash
sam deploy --guided
```

During deployment, provide your NASA FIRMS Map Key when prompted:

```text
FirmsMapKey=<your-key>
```

After deployment:

1. Upload `data/history_cells.json` to the S3 bucket created by the stack.
2. Trigger the ingestion Lambda once.
3. Copy the API Gateway endpoint.
4. Update `API_BASE` in `web/app.js`.

Example:

```javascript
const API_BASE = "https://your-api-id.execute-api.region.amazonaws.com";
```

---

# 📁 Project Structure

```text
saans/
│
├── backend/
│   ├── template.yaml
│   └── ...
│
├── data/
│   └── history_cells.json
│
├── scripts/
│   └── run_pipeline_local.py
│
├── tests/
│   └── ...
│
├── web/
│   ├── index.html
│   ├── app.js
│   └── styles.css
│
├── .env.example
├── Makefile
├── requirements.txt
└── README.md
```

---

# 🎯 Target Cities

The initial module focuses on major cities in the Delhi-NCR and northwestern India smoke-transport corridor:

- **Delhi**
- **Ludhiana**
- **Chandigarh**

The architecture can be extended to additional cities without changing the core ingestion pipeline.

---

# 🔮 Future Improvements

## Module 2 — Advanced Smoke Transport

Potential improvements include:

- NOAA / HRRR / ECMWF meteorological data
- Vertical wind profiles
- Planetary Boundary Layer height
- Multi-altitude trajectory modeling
- More advanced atmospheric transport models

## Module 3 — Computer Vision

Satellite imagery could be used to estimate:

- Burned-area boundaries
- Crop-residue burning patterns
- Fire progression

## Module 4 — Machine Learning

Historical fire detections and meteorological conditions could be used to predict:

- Probability of fire ignition
- Fire-cluster growth
- Expected smoke impact

## Module 5 — Citizen & Administration Alerts

```text
Fire Detected
      |
      v
Risk Threshold Exceeded
      |
      v
Smoke Transport Detected
      |
      v
Target City Identified
      |
      v
Alert Generated
```

---

# 🌱 Impact

Saans is designed around a simple principle:

> **Detect earlier → understand faster → prepare sooner.**

Instead of presenting citizens and authorities with only an AQI number after pollution has already arrived, Saans attempts to provide an interpretable picture of:

```text
WHERE are fires?
       |
       v
HOW ACTIVE are they?
       |
       v
WHICH fires are upwind?
       |
       v
WHEN could smoke arrive?
       |
       v
WHAT is the estimated threat level?
```

The goal is to transform raw satellite and weather data into an **early-warning layer for environmental decision-making**.

---

# 📜 Disclaimer

Saans provides **experimental risk scores and simplified smoke-arrival estimates** for research and demonstration purposes.

It should not be treated as an official air-quality forecast, emergency-management system, or substitute for measurements and forecasts issued by government agencies and professional atmospheric models.

---

## 👨‍💻 Built For

**Environmental Hacks Hackathon**  
**Track:** Air — Module 1  
**Project:** Saans (साँस) — Stubble Fire Early Warning System
