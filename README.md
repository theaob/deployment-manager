# Deployment Manager

A lightweight, self-hosted deployment reservation system for engineering teams. Allows users to "book" deployments for testing or work, ensuring no two people use the same one simultaneously.

## Features

- **Lightweight**: Built with Node.js and SQLite - no heavy database required.
- **Simple Authentication**: Log in with your name; first user becomes admin.
- **SSO Support**: Trusted-header SSO or Keycloak/OpenID Connect for centralized authentication.
- **Cluster Management**: Define clusters and the deployments within them.
- **Reservation System**:
  - Users can reserve any deployment, optionally for a fixed duration — the reservation is auto-released once it elapses.
  - Reservations are time-stamped and visible in history.
  - Admins can see all reservations across all deployments, and force-release any of them.
  - Users can see their own history.
- **Release Notifications**: Optional email (SMTP) and Zulip DM to a user when someone else releases their reservation for them — configured live from the Admin panel.
- **Rancher Integration**: Shows the live status of the Rancher Helm app each deployment corresponds to, right on the dashboard — configured live from the Admin panel.
- **Config-Driven**: Easily define your cluster structure in `config/clusters.json`.

## Prerequisites

- Node.js 20 or higher.
- (Optional) Docker and Docker Compose for containerized deployments.

## Setup

1.  **Clone the repository** (or download the code).
2.  **Install dependencies**:
    ```bash
    cd deployment-manager
    npm install
    ```

3.  **Configure your clusters** (Optional):
    If you don't want to use the default configuration, create or edit `config/clusters.json`. The file should be in this format:

    ```json
    {
      "clusters": [
        {
          "id": "k8s-preprod-euw1",
          "name": "Preprod EUW1",
          "environment": "preprod",
          "deployments": [
            {
              "id": "deploy-api-123",
              "name": "API-123 (Preprod)"
            },
            {
              "id": "deploy-admin-123",
              "name": "Admin-123 (Preprod)"
            }
          ]
        }
      ]
    }
    ```

    The `id` fields are used internally by the system.

4.  **Run the server**:
    - For production:
      ```bash
      npm start
      ```
    - For local development (with automatic reloading via nodemon):
      ```bash
      npm run dev
      ```
    The server will start on `http://localhost:3000`.

### Docker

To run the application inside a single Docker container:

```bash
docker build -t deployment-manager .
docker run -p 3000:3000 --name dm -v dm-data:/app/data deployment-manager
```

> **Note:** The `-v dm-data:/app/data` flag ensures the SQLite database is persisted across container restarts.

### Docker Compose (Recommended)

A multi-container setup with Nginx serving as a reverse proxy is configured in the root directory. To run using Docker Compose:

1. Create a `data` directory in the project root to persist the SQLite database.
2. Build and start the containers:
   ```bash
   docker-compose up -d
   ```

The Nginx proxy exposes port `80`, routing incoming HTTP traffic to the application container (listening on port `3000` internally). The app can then be accessed at `http://localhost`.

This setup is ideal for integrating with Windows/Active Directory single sign-on using the SPNEGO/Kerberos Nginx module (pre-configured to forward identity headers securely).

### Upgrading & Data Persistence

> [!IMPORTANT]
> **Verify this before you rely on any of it.** Everything below assumes `/app/data` is actually bind-mounted to something on the host — true for this repo's own `docker-compose.yml` (`./data:/app/data`), but **not** automatic if you wrote your own compose file (e.g. to pull a pre-built image from a registry instead of `build: .`). With no mount, the database lives *inside the container's own writable layer* — it looks like it's persisting across plain restarts, but a full recreate (`docker-compose down` + `up`, `docker rm`, a new image) starts the container fresh with nothing in `/app/data`, silently wiping every cluster, reservation, user, and integration setting (the first person to sign back in becomes admin again, as if this were a brand new install — that's the tell).
>
> Check right now:
> ```bash
> docker inspect deployment-manager --format '{{json .Mounts}}'
> ```
> If that's empty (`[]` / `null`) or doesn't list `/app/data`, add a `volumes:` entry to your compose service:
> ```yaml
> services:
>   deployment-manager:
>     # ...
>     volumes:
>       - ./data:/app/data
> ```
> then `docker-compose up -d` once — Docker creates `./data` on the host automatically if it doesn't exist. This only protects data going forward; anything already lost to a prior reset is not recoverable.

**Everything is in one file.** Clusters, deployments, reservations, users, and the SMTP/Zulip notification settings all live in a single SQLite database at `data/deployment-manager.db` — nothing else needs backing up or migrating separately. As long as that directory is genuinely bind-mounted (see above), it is **never** touched by `docker-compose down`, `docker-compose down -v`, `docker rm`, or an image update — the only way to lose it is to delete the `data/` directory yourself. Schema changes between versions only ever *add* columns/tables on startup; upgrading never drops or rewrites existing rows.

**To upgrade** (when using a pre-built image rather than `build: .`):
```bash
docker-compose pull        # docker-compose alone does NOT fetch a newer image for an existing tag
docker-compose up -d
```
Plain `docker-compose up -d` reuses whatever image is already cached locally for that tag — without an explicit `pull` first, "updating" silently does nothing.

> [!WARNING]
> **`KeyError: 'ContainerConfig'` on `up -d` after a new image arrives?** This is a well-known bug in the legacy Python `docker-compose` (v1, deprecated) — it happens when that tool tries to recreate an *existing* container in place against a new image. It's unrelated to this app. Two fixes:
> 1. **Best:** switch to Docker Compose V2 — use `docker compose` (a space, no hyphen) instead of `docker-compose`. Check availability with `docker compose version`; on Ubuntu, install it with `sudo apt install docker-compose-plugin` if missing. V2 doesn't have this bug.
> 2. **Quick workaround** without changing tooling: remove the stale container before `up`, since the bug only triggers when recreating one in place:
>    ```bash
>    docker rm -f deployment-manager
>    docker-compose up -d
>    ```
>    (This is safe — it never touches the `data/` bind mount.)

### General Configuration

The following environment variables can be set to configure the server's basic behavior:

| Variable | Required | Default / Example | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | The port the application server listens on. |
| `JWT_SECRET` | No (recommended for prod) | `deployment-manager-secret-key-change-in-production` | Secret key used to sign and verify JSON Web Tokens (JWT). |
| `NODE_ENV` | No | `development` / `production` | Node environment state. |
| `TRUST_PROXY` | No | `true` | Set to `true` only when a reverse proxy (e.g. the bundled Nginx service) sits in front of this container and terminates TLS. Makes the app honor `X-Forwarded-Proto`/`X-Forwarded-For` so OIDC cookies get the `Secure` flag only when the client actually connected over HTTPS. **Do not enable this if clients can reach the container directly** — without a real proxy in front, a client could spoof these headers itself. |
| `RANCHER_CA_CERT_PATH` | No | `/certs/rancher-ca.pem` | Path to a PEM CA certificate (or bundle) to trust when calling the Rancher API — for a Rancher instance on an internal/self-signed CA (see [Rancher Integration](#rancher-integration) below). |
| `RANCHER_TLS_REJECT_UNAUTHORIZED` | No | `false` | Set to `false` to skip TLS certificate verification for the Rancher API entirely. Internal/test environments only — prefer `RANCHER_CA_CERT_PATH`. |

By default, the app uses a simple username-based login (no password) — the first user to sign in becomes admin. This is the fallback whenever neither Trusted Header SSO nor OIDC below is configured.

### Trusted Header SSO (Single Sign-On)

For zero-interaction automated login, you can place the application behind a reverse proxy or Ingress gateway (such as OAuth2 Proxy, Authelia, or Nginx configured with GSSAPI/SPNEGO) that handles authentication and forwards the user's identity in an HTTP header.

To enable this mode, set the `SSO_HEADER` environment variable to the name of the header injected by your proxy:

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `SSO_HEADER` | Yes | `X-Remote-User` | Name of the HTTP header containing the authenticated user's username. Enables automatic login. |

**Example** (Docker):
```bash
docker run -p 3000:3000 \
  -e SSO_HEADER=X-Remote-User \
  --name dm deployment-manager
```

When `SSO_HEADER` is set, the application will automatically sign in users using the value of that header and bypass the login interface entirely.

> [!CAUTION]
> **Critical Security Warning:** When Trusted Header SSO is enabled, the application treats the configured header as complete proof of authentication. You **must** ensure that:
> 1. Clients cannot access the application container directly (e.g. configure network firewalls/Kubernetes Network Policies to block external traffic and only accept connections from your reverse proxy).
> 2. The reverse proxy is configured to strip/sanitize the `SSO_HEADER` from all incoming client requests *before* adding its own verified header.

### Keycloak / OpenID Connect (OIDC) SSO

You can offload authentication to a Keycloak realm or any OpenID Connect (OIDC) identity provider. When OIDC is configured, the login screen displays only a "Sign In with Keycloak" button — there is no manual username fallback. Keycloak becomes the sole source of identity: `POST /api/auth/login` rejects any manually-typed username outright (`403 Manual login is disabled`), so every user must authenticate through your realm.

To enable OIDC, set the following environment variables:

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `OIDC_ISSUER` | Yes | `http://localhost:8080/realms/myrealm` | The base URL of the Keycloak/OIDC realm. Enables OIDC mode. |
| `OIDC_CLIENT_ID` | Yes | `deployment-manager` | The Client ID configured in Keycloak. |
| `OIDC_REDIRECT_URI` | Yes | `http://localhost:3000/api/auth/oidc/callback` | The callback URL registered in Keycloak. |
| `OIDC_CLIENT_SECRET` | No | `your-client-secret` | The Client Secret. Only required for confidential clients; omit for public clients. |
| `OIDC_CA_CERT_PATH` | No | `/app/certs/ca.crt` | Path to a PEM CA certificate to trust when connecting to Keycloak, in addition to Node's default trust store. Use this when Keycloak's TLS certificate is signed by an internal/intranet CA (or is self-signed) — fixes `self-signed certificate in certificate chain` errors. |
| `OIDC_TLS_REJECT_UNAUTHORIZED` | No | `false` | Set to `false` to skip TLS certificate verification entirely for OIDC requests. Only for internal/test environments — prefer `OIDC_CA_CERT_PATH` whenever possible. |

> **Certificate errors:** If OIDC login fails with `self-signed certificate in certificate chain`, Node doesn't trust the CA that issued Keycloak's TLS certificate. Export that CA's certificate as PEM, mount it into the container, and set `OIDC_CA_CERT_PATH` to its path — this trusts your CA specifically rather than disabling verification.

> **"State parameter mismatch or verification session expired":** This means the `oidc_state`/`oidc_code_verifier` cookies set at `/api/auth/oidc/login` never made it back on the callback request. The app only marks these cookies `Secure` when the request actually arrived over HTTPS — directly, or via `X-Forwarded-Proto: https` from a reverse proxy *if you've set `TRUST_PROXY=true`*. Plain HTTP (with or without Nginx in front, as long as `TRUST_PROXY` isn't set) already works correctly out of the box. If you still see this error, check for: a proxy not forwarding `Set-Cookie` back to the client, a different host/port between the login and callback requests, or the Keycloak login taking longer than the 5-minute cookie lifetime.

#### Keycloak Client Configuration:
1. Create a client with ID `deployment-manager` (or matching `OIDC_CLIENT_ID`).
2. Set **Access Type / Client Authentication** to `public` (recommended if you don't have realm admin rights to obtain client secrets) or `confidential`.
3. Enable **Standard Flow** (Authorization Code flow).
4. Add `http://localhost:3000/api/auth/oidc/callback` (or your production callback URL) to the **Valid Redirect URIs** list.

**Example** (Docker):
```bash
docker run -p 3000:3000 \
  -e OIDC_ISSUER=https://keycloak.example.com/realms/myrealm \
  -e OIDC_CLIENT_ID=deployment-manager \
  -e OIDC_REDIRECT_URI=https://deploy.example.com/api/auth/oidc/callback \
  --name dm deployment-manager
```

## Usage

### Logging In

1.  Open `http://localhost:3000`.
2.  Enter your name in the login box and click "Log in".
3.  The first user to log in automatically becomes an admin.

### The Dashboard

- **Current Reservations**: A table showing who has which deployment reserved and when it expires.
- **Available Deployments**: A list of all deployments. Click "Reserve" to book one.
- **My Reservations**: A tab showing only the reservations you have made.

### Admin Features

Admins have access to an "Admin" section:

- **Users**: View all users, change their roles between `user` and `admin`, and set each user's email address (used for release notifications below).
- **History**: A complete audit log of all reservations ever made, filterable by deployment or user.
- **Cluster Management**: Add or remove clusters and deployments manually.
- **Release Notifications**: Configure SMTP and/or Zulip, editable at runtime (unlike the auth-provider settings, these aren't environment variables — see below).
- **Rancher Integration**: Configure the Rancher URL/API token, and map each cluster/deployment to the Rancher app it corresponds to (see below).

### Release Notifications

When a reservation is released by someone *other* than the person who made it — an admin force-release, or an automatic release once a timed reservation's duration runs out — the reservation's owner can be notified by email and/or a Zulip private message. A user releasing their own reservation never triggers a notification (they already know, they just did it).

Configure this from **Admin → Release Notifications**:

- **Email (SMTP)**: host, port, TLS/SSL toggle, username/password, and a "From" address.
- **Zulip**: your Zulip site URL, a bot's email, and its API key ([create a bot](https://zulip.com/help/add-a-bot-or-integration) with "Generic bot" type in your Zulip organization).

Both channels send to the same address: the recipient's **email**, set per-user in the Users table above. This assumes their Zulip account uses that same email — if your organization's Zulip is SSO'd against the same identity provider, it usually does. For OIDC/Keycloak users, email is populated automatically from the `email` claim on every login (and kept in sync with the IdP); for local/SSO-header users, an admin sets it by hand.

Passwords and API keys are stored in the database, never echoed back by `GET /api/admin/settings` (only whether one is set) — leave the field blank when saving to keep the current secret. Use **Send Test Notification** to verify your configuration; it sends a test message to your own admin account's email (so make sure that's set too).

> These settings live in the database and are editable from the Admin panel at runtime — unlike `OIDC_*`/`AD_*`/`SSO_HEADER`, there's no environment variable equivalent.

### Rancher Integration

If deployments are actually rolled out via Rancher — deploying a Helm/Catalog app under **Apps & Marketplace** — the dashboard can show that app's live status (Deployed, Failed, or a transitioning state like Upgrading) right next to each deployment, without leaving this tool.

**1. Create a Rancher API token.** In Rancher, go to your user avatar (top right) → **Account & API Keys** → **Create API Key**. Copy the generated token.

**2. Configure the connection.** From **Admin → Rancher Integration**:
- Check **Show Rancher app status on the dashboard**.
- **Rancher URL**: your Rancher server's base URL, e.g. `https://rancher.example.com`.
- **API Token**: the token from step 1.
- Click **Test Connection** to verify.

**3. Map each cluster to its Rancher cluster.** Under **Admin → Clusters & Deployments**, each cluster has a **Rancher cluster ID** field — the Rancher-internal cluster id (e.g. `c-m-abc12345`, or `local` for the Rancher server's own local cluster), visible in the Rancher UI's URL when you're viewing that cluster.

**4. Map each deployment to its Rancher app.** Each deployment has **namespace** and **Rancher app name** fields — the namespace and release name shown in Rancher under that cluster's **Apps & Marketplace → Installed Apps**.

A deployment with no mapping (or an unconfigured/disabled integration) simply shows no status badge — this is entirely opt-in, deployment by deployment. Status lookups are cached for 15 seconds to avoid hammering the Rancher API when multiple users have the dashboard open; a lookup that fails (wrong token, app renamed, Rancher unreachable) shows a "Rancher unavailable" badge rather than breaking the dashboard.

If your Rancher instance is on an internal/self-signed CA (common on an intranet with no public internet access), see the `RANCHER_CA_CERT_PATH` / `RANCHER_TLS_REJECT_UNAUTHORIZED` environment variables above — same approach as the Keycloak/OIDC TLS configuration.

## API Reference

All endpoints require authentication (via the `Authorization: Bearer <token>` HTTP header), except for the public endpoints noted below.

### Authentication Endpoints

| Method | Path | Public | Description |
|--------|------|--------|-------------|
| `GET` | `/api/auth/mode` | Yes | Returns the current active auth mode (`local`, `sso`, `oidc`). |
| `POST` | `/api/auth/login` | Yes | Authenticates user (methods vary by mode). Returns a JWT token and user info. |
| `GET` | `/api/auth/me` | No | Gets information about the currently logged-in user. |
| `GET` | `/api/auth/oidc/login` | Yes | Redirects browser to Keycloak/OIDC provider to initiate SSO flow. |
| `GET` | `/api/auth/oidc/callback` | Yes | Callback receiver for OIDC authentication redirect. |

### Cluster & Deployment Endpoints

| Method | Path | Public | Description |
|--------|------|--------|-------------|
| `GET` | `/api/clusters` | No | Gets all clusters, deployments, and their active reservation status. |
| `GET` | `/api/clusters/:clusterId` | No | Gets details of a single cluster and its deployments. |
| `POST` | `/api/deployments/:id/reserve` | No | Reserves a deployment for the logged-in user. Body: `{ notes?: string, duration_minutes?: number }`. Omit `duration_minutes` (or pass `null`) for no time limit; otherwise the reservation is auto-released once it elapses (max 43200 = 30 days). |
| `POST` | `/api/deployments/:id/release` | No | Releases a deployment reservation (only reservor or admin can release). |
| `GET` | `/api/deployments/:id/history` | No | Gets reservation history of a single deployment. |
| `GET` | `/api/deployments/my-reservations/active` | No | Gets all active reservations for the current user. |

### Administration Endpoints (Admin Role Required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/clusters` | Creates a new cluster. Body: `{ name: string, environment: string }`. |
| `PUT` | `/api/admin/clusters/:id` | Updates a cluster's name, environment, or Rancher cluster ID mapping. Body: `{ name?: string, environment?: string, rancher_cluster_id?: string \| null }`. |
| `DELETE` | `/api/admin/clusters/:id` | Deletes a cluster and its deployments (requires all deployments to be unreserved). |
| `POST` | `/api/admin/clusters/:id/deployments` | Adds a deployment to a cluster. Body: `{ name: string }`. |
| `DELETE` | `/api/admin/deployments/:id` | Deletes a deployment (requires it to be unreserved). |
| `PUT` | `/api/admin/deployments/:id/rancher` | Maps (or clears) the Rancher app this deployment corresponds to. Body: `{ rancher_namespace?: string \| null, rancher_app_name?: string \| null }`. |
| `GET` | `/api/admin/users` | Lists all registered users. |
| `PUT` | `/api/admin/users/:id/role` | Updates a user's role. Body: `{ role: 'admin' \| 'user' }`. |
| `PUT` | `/api/admin/users/:id/email` | Sets (or clears) a user's email address. Body: `{ email: string \| null }`. |
| `GET` | `/api/admin/settings` | Returns the current SMTP/Zulip/Rancher settings. Secret fields are never echoed back — only `smtp_pass_set`/`zulip_bot_api_key_set`/`rancher_api_token_set` booleans. |
| `PUT` | `/api/admin/settings` | Updates SMTP/Zulip/Rancher settings. Omit or send an empty secret field to keep the currently stored value. |
| `POST` | `/api/admin/settings/test` | Sends a test notification through every enabled channel to the requesting admin's own email. |
| `POST` | `/api/admin/settings/test-rancher` | Verifies the configured Rancher URL/API token work, independent of any cluster/app mapping. |
| `GET` | `/api/admin/history` | Gets full reservation history across all deployments. Query params: `cluster_id`, `user_id`, `limit`, `offset`. |


## Releasing

Docker images are published to DockerHub automatically via GitHub Actions whenever a version tag is pushed.

### Setup (one-time)

Add these secrets to your GitHub repository under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Your DockerHub username |
| `DOCKERHUB_TOKEN` | A DockerHub [access token](https://hub.docker.com/settings/security) |

### Creating a release

1. Go to **Releases → Draft a new release** on GitHub.
2. Create a new tag (e.g. `v1.0.0`) and fill in the release notes.
3. Click **Publish release**.

The workflow will automatically build and push two Docker images:

- `<your-dockerhub-user>/deployment-manager:1.0.0`
- `<your-dockerhub-user>/deployment-manager:latest`

### Pulling a release

```bash
docker pull <your-dockerhub-user>/deployment-manager:latest
docker run -d -p 3000:3000 -v dm-data:/app/data <your-dockerhub-user>/deployment-manager:latest
```

> **Note:** The `-v dm-data:/app/data` flag persists the SQLite database across container restarts.

If you're running this via Docker Compose instead, see [Upgrading & Data Persistence](#upgrading--data-persistence) above — including a fix for the `KeyError: 'ContainerConfig'` error some hit when pulling a new image without removing the old container first.

## License

MIT
