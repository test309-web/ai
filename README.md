# SoftAtlas AI Playground

A dark Next.js chat UI hosted on Vercel. Browser requests go to the same-origin `/api/chat` route. That server-side route checks the tester password and forwards requests to a private-authenticated gateway on your Oracle VM. The gateway talks to Ollama over localhost only.

## Important security rules

- Do NOT expose Ollama port `11434` to the internet.
- Do NOT put `ORACLE_API_TOKEN`, `PLAYGROUND_PASSWORD`, or Oracle URLs in `NEXT_PUBLIC_*` variables.
- Keep Ollama bound to `127.0.0.1:11434`.
- Use HTTPS for `ORACLE_AI_URL`.
- Do not give your tester SSH, Oracle Cloud, or server credentials.
- The sample in-memory rate limiter is suitable only for a small test. For public/long-term use, add Redis or a managed rate limiter and rotate secrets.

## 1. Deploy the frontend to Vercel

1. Upload this folder to a private GitHub repository.
2. Import the repository in Vercel.
3. Add these Environment Variables in Vercel Project Settings:
   - `PLAYGROUND_PASSWORD`: a long unique password shared only with your friend.
   - `ORACLE_AI_URL`: `https://ai-api.yourdomain.com`
   - `ORACLE_API_TOKEN`: a long random secret.
   - `ALLOWED_MODELS`: comma-separated exact Ollama model names, e.g. `llama3.2:1b,qwen2.5:3b`
4. Redeploy after adding variables.
5. To add models to the dropdown, edit `MODELS` in `app/page.tsx` and `ALLOWED_MODELS` in Vercel and Oracle backend, then redeploy/restart.

## 2. Deploy the Oracle gateway

Assumes Ubuntu, Ollama already installed and running, and the `ubuntu` user. Replace the example domain with a domain you control.

```bash
sudo mkdir -p /opt/softatlas-gateway
sudo chown ubuntu:ubuntu /opt/softatlas-gateway
```

Copy `oracle-backend/main.py` and `requirements.txt` into `/opt/softatlas-gateway`, then:

```bash
cd /opt/softatlas-gateway
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

Generate a token on the Oracle VM:

```bash
openssl rand -hex 32
```

Create the environment file using the generated token (use the exact same value in Vercel):

```bash
sudo nano /etc/softatlas-gateway.env
```

Contents:

```bash
ORACLE_API_TOKEN=PASTE_GENERATED_SECRET_HERE
OLLAMA_URL=http://127.0.0.1:11434
ALLOWED_MODELS=llama3.2:1b
RATE_LIMIT_PER_MINUTE=12
```

Protect it:

```bash
sudo chown root:root /etc/softatlas-gateway.env
sudo chmod 600 /etc/softatlas-gateway.env
```

Install the systemd service:

```bash
sudo cp softatlas-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now softatlas-gateway
sudo systemctl status softatlas-gateway
```

## 3. Put HTTPS in front of the gateway

1. Create DNS A record `ai-api.yourdomain.com` pointing to the Oracle VM public IP.
2. Install Caddy using its official Ubuntu instructions.
3. Add the contents of `Caddyfile.example` to the Caddy config, replacing the example hostname.
4. Allow inbound TCP 80 and 443 in Oracle Cloud networking and the VM firewall. Do NOT open 8000 or 11434 publicly.
5. Caddy obtains and renews the TLS certificate automatically when DNS and ports are correct.

## 4. Test

On Oracle VM:

```bash
curl http://127.0.0.1:8000/health
```

Expected: `{"status":"ok"}`.

Then visit the Vercel URL, enter the tester password, select an enabled model and send a test message.

## 5. Model access

Only expose models you explicitly approve. For every approved model:
- Add it to `MODELS` in `app/page.tsx`.
- Add the exact model name to `ALLOWED_MODELS` in Vercel.
- Add the exact model name to `/etc/softatlas-gateway.env` on Oracle.
- Restart gateway: `sudo systemctl restart softatlas-gateway`.

## Limitations of this starter

- Password gate is a shared test password, not a full user-management system.
- It stores the password in the browser session for the current tab.
- Rate limiting is a basic in-memory per-process limit and may reset on restart/scale-out.
- No conversation history is stored by the app.
- For more than a trusted friend / short trial, use proper authentication, persistent rate limiting, monitoring, and secret rotation.
