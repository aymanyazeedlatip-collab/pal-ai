# PAL-AI Exact Deployment Guide

This package is prepared for the existing setup:

- One GitHub repository
- Vercel serves `frontend/`
- Render serves the FastAPI backend from the repository root
- The existing Gemini and Google Weather environment variables remain on Render

## A. Replace the repository files with GitHub Desktop

1. Download and extract `PALAI_READY_DEPLOY_WITH_REGION12_WEB_PRELOAD.zip`.
2. Open **GitHub Desktop**.
3. Select the existing PAL-AI repository from the **Current repository** menu.
4. Click **Repository > Show in Explorer**.
5. In the repository folder, keep the hidden `.git` folder. Delete the old project files and folders, then copy every file and folder from the extracted package into that repository folder.
6. Return to GitHub Desktop. Wait for the changed-file list to finish loading.
7. In **Summary**, enter: `Deploy final PAL-AI build with Region XII web preload`.
8. Click **Commit to main**. Use the production branch instead if the project uses a branch other than `main`.
9. Click **Push origin**.
10. Open the GitHub repository in a browser and confirm the newest commit appears.

Do not create or upload `backend/.env`. API keys must remain in Render environment variables.

## B. Verify the Render backend deployment

1. Open the Render dashboard.
2. Open the existing PAL-AI web service, expected to be named `pal-ai-tupinhs`.
3. Open **Settings** and confirm:
   - Root Directory: blank
   - Build Command: `pip install --upgrade pip && pip install -r requirements.txt`
   - Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
   - Health Check Path: `/api/health`
4. Open **Environment**. Do not replace working secrets. Confirm the previous values still exist:
   - `LLM_API_KEY`
   - `LLM_MODEL` with the working Gemini model name
   - `GOOGLE_WEATHER_API_KEY`
5. Open **Events** or **Deploys**. The GitHub push should start a new deploy automatically.
6. If it does not start, click **Manual Deploy > Deploy latest commit**.
7. Open **Logs**. Wait until the build completes and Uvicorn starts successfully.
8. Open:
   `https://pal-ai-tupinhs.onrender.com/api/health`
9. Confirm the response contains `"status":"ok"` and `"model_loaded":true`.
10. Open:
    `https://pal-ai-tupinhs.onrender.com/api/elevation-preload/region12/status`
11. Confirm it returns JSON with `"ok":true` and a preload status such as `idle`.

### Cache persistence on Render

The website toggle works on the existing Render web service. However, a Render Free service stores runtime SQLite changes on an ephemeral filesystem, so newly preloaded points disappear after a restart or redeploy.

For temporary demonstration use, no extra setting is required. Run the toggle after the backend has deployed.

For persistence across restarts, use one of these later:

- Attach a persistent disk to a paid Render service and set `PALAI_ELEVATION_CACHE_DB` to a path on that disk, such as `/var/data/elevation_cache.sqlite`.
- Configure the existing optional Upstash Redis variables used by PAL-AI:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

## C. Verify the Vercel frontend deployment

1. Open the Vercel dashboard.
2. Open the existing PAL-AI project.
3. Open **Settings > Build and Deployment**.
4. Confirm:
   - Root Directory: `frontend`
   - Framework Preset: `Other`
   - Build Command: blank
   - Output Directory: blank
   - Install Command: blank
5. Open **Deployments**. The same GitHub push should create a deployment automatically.
6. Wait for the deployment to show **Ready**.
7. If no deployment appears, select the latest deployment menu and choose **Redeploy**, or trigger another small GitHub commit.
8. Open the production Vercel URL.
9. Press `Ctrl + Shift + R` once to bypass old cached JavaScript and CSS.

## D. Run the Region XII preload from the website

1. Open the deployed PAL-AI site.
2. Enter the website from the welcome screen.
3. Open the navigation Menu.
4. Click **Settings** near the bottom of the sidebar.
5. Find **Preload Region XII Elevation Data**.
6. Turn on **Start preload**.
7. Keep the Settings panel and browser page open while it runs.
8. Watch the real progress values:
   - Tiles
   - Processed points
   - Newly saved points
   - Failed points
   - Percentage
9. Turning the switch off requests a graceful stop after the active OpenTopoData request finishes.
10. When the status says **Completed**, close Settings and run a Region XII 3D terrain scan.

The full preload covers 374 fixed 10 km tiles and 252,824 tile-points before cache deduplication. It can take a long time because it uses the public OpenTopoData service in paced batches.

## E. Final production checks

1. Forecast page: regions load and Region XII forecast generates.
2. Short-term planting page: live Google Weather results load.
3. Long-term planting page: monthly calendars and PDF generation work.
4. 3D Terrain: elevation progress advances and a real DEM surface renders.
5. Farm Health: automatically runs after terrain generation.
6. Soil and fertilizer: profile visualizers render.
7. Pest analysis: report generates.
8. PALADIN text chat works.
9. PALADIN image analysis reports pests, diseases, and leaf discoloration.
10. Settings: Region XII preload status endpoint responds and the toggle starts only one job.

## F. If something fails

### Render build fails

Open Render Logs and identify the first red error. Confirm the build and start commands exactly match Section B.

### Frontend loads but data does not

Open `https://pal-ai-tupinhs.onrender.com/api/health`. If it does not respond, wait for Render to wake or inspect Render Logs.

### Old interface still appears

Hard-refresh with `Ctrl + Shift + R`. If needed, redeploy the latest Vercel deployment without build cache.

### Region XII preload stops unexpectedly

A Render restart terminates the background thread. Open Settings and start it again. Existing cached points remain only if persistent storage or Redis is configured.
