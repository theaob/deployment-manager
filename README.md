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

### General Configuration

The following environment variables can be set to configure the server's basic behavior:

| Variable | Required | Default / Example | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | The port the application server listens on. |
| `JWT_SECRET` | No (recommended for prod) | `deployment-manager-secret-key-change-in-production` | Secret key used to sign and verify JSON Web Tokens (JWT). |
| `NODE_ENV` | No | `development` / `production` | Node environment state. |
| `TRUST_PROXY` | No | `true` | Set to `true` only when a reverse proxy (e.g. the bundled Nginx service) sits in front of this container and terminates TLS. Makes the app honor `X-Forwarded-Proto`/`X-Forwarded-For` so OIDC cookies get the `Secure` flag only when the client actually connected over HTTPS. **Do not enable this if clients can reach the container directly** — without a real proxy in front, a client could spoof these headers itself. |

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

- **Users**: View all users and change their roles between `user` and `admin`.
- **History**: A complete audit log of all reservations ever made, filterable by deployment or user.
- **Cluster Management**: Add or remove clusters and deployments manually.

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
| `PUT` | `/api/admin/clusters/:id` | Updates a cluster's name or environment. Body: `{ name?: string, environment?: string }`. |
| `DELETE` | `/api/admin/clusters/:id` | Deletes a cluster and its deployments (requires all deployments to be unreserved). |
| `POST` | `/api/admin/clusters/:id/deployments` | Adds a deployment to a cluster. Body: `{ name: string }`. |
| `DELETE` | `/api/admin/deployments/:id` | Deletes a deployment (requires it to be unreserved). |
| `GET` | `/api/admin/users` | Lists all registered users. |
| `PUT` | `/api/admin/users/:id/role` | Updates a user's role. Body: `{ role: 'admin' \| 'user' }`. |
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

## License

MIT
