# Chirp-Web

Web-based radio memory file converter powered by [CHIRP](https://chirp.danplanet.com). Upload a radio memory image or choose from 20 built-in preset frequency lists, pick a target radio, and download the converted file — no desktop install needed.

## Features

- **189+ radios** supported via CHIRP's driver library
- **Auto-detection** of source radio from uploaded image files
- **20 preset memory lists** — NOAA Weather, FRS/GMRS, MURS, Marine VHF, Aviation, PMR, and more (grouped by region: US, CA, EU, AU/NZ, DE, FR, GR, PL, SE, UK)
- **Memory conversion** with frequency, tone, power level, and duplex mapping
- **Multilanguage UI** — English, Italian, French, German, Spanish (auto-detected, switchable)
- **OpenAPI docs** at `/docs` (built-in FastAPI)

## Getting a Radio Image File

Chirp-Web converts between existing image files — it doesn't communicate with radios directly. To get an `.img` file from your radio:

1. Install the [CHIRP desktop app](https://chirp.danplanet.com/projects/chirp/wiki/Download)
2. Connect your radio via USB/serial cable
3. **Radio → Download From Radio** (`Ctrl+D`)
4. Select your port and radio model, click OK
5. **File → Save As** to save a `.img` file

Upload that `.img` file to Chirp-Web for conversion. `.csv` and `.chirp` exports from CHIRP also work.

## Quick Start

Requires Docker.

```bash
./build.sh            # downloads chirp source + builds image
docker compose up     # http://localhost:8000
```

For background mode: `docker compose up -d`

## Development

The `app/` directory is volume-mounted, so code changes reload automatically via uvicorn `--reload`.

```bash
docker compose up           # start with live reload
docker compose logs -f      # follow logs
docker compose down         # stop
```

To rebuild after changing dependencies:

```bash
./build.sh
docker compose up --build
```

### Project Structure

```
chirp-web/
├── app/
│   ├── main.py              # FastAPI app, startup
│   ├── config.py            # Settings (upload dir, limits)
│   ├── converter.py         # CHIRP integration (detect, convert, presets)
│   ├── routers/
│   │   ├── api.py           # REST API (radios, stock-configs, detect, convert, download)
│   │   └── pages.py         # HTML page routes
│   ├── templates/           # Jinja2 templates
│   └── static/              # CSS + JS
├── uploads/                 # Temp uploaded files (gitignored)
├── Dockerfile
├── docker-compose.yml
├── build.sh                 # Build helper (downloads chirp from GitHub)
├── requirements.txt
└── pyproject.toml
```

## API

| Method | Endpoint              | Description                              |
|--------|-----------------------|------------------------------------------|
| GET    | `/api/radios`         | List all supported radios by vendor      |
| GET    | `/api/stock-configs`  | List available preset memory lists       |
| POST   | `/api/detect`         | Upload file, auto-detect source radio    |
| POST   | `/api/convert`        | Convert file or preset to target radio   |
| GET    | `/api/download/{token}` | Download converted file (expires 10 min) |

### Example: Convert via curl

```bash
# Detect source radio
curl -F "file=@Baofeng_UV-5R.img" http://localhost:8000/api/detect

# Convert from an uploaded file
curl -F "file=@Baofeng_UV-5R.img" \
     -F "dest_vendor=Baofeng" \
     -F "dest_model=UV-82" \
     http://localhost:8000/api/convert

# Convert from a preset memory list
curl -F "stock_config=US NOAA Weather Alert.csv" \
     -F "dest_vendor=Baofeng" \
     -F "dest_model=UV-5R" \
     http://localhost:8000/api/convert
```

## License

GPL-3.0 — same as CHIRP.
