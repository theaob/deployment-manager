# Deployment Manager

A lightweight, self-hosted deployment reservation system for engineering teams. Allows users to "book" deployments for testing or work, ensuring no two people use the same one simultaneously.

## Features

- **Lightweight**: Built with Node.js and SQLite - no heavy database required.
- **Simple Authentication**: Log in with your name; first user becomes admin.
- **Active Directory Support**: Optionally authenticate users against an AD/LDAP server.
- **Cluster Management**: Define clusters and the deployments within them.
- **Reservation System**:
  - Users can reserve any deployment.
  - Reservations are time-stamped and visible in history.
  - Admins can see all reservations across all deployments.
  - Users can see their own history.
- **Config-Driven**: Easily define your cluster structure in `config/clusters.json`.

## Prerequisites

- Node.js 16 or higher.
- (Optional) Docker for running in a container.

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
    ```bash
    npm start
    ```
    The server will start on `http://localhost:3000`.

### Docker

To run in Docker:

```bash
docker build -t deployment-manager .
docker run -p 3000:3000 --name dm deployment-manager
```

### Active Directory Authentication

By default, the app uses a simple username-based login (no password). To enable Active Directory authentication, set the following environment variables:

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `AD_URL` | Yes | `ldap://10.0.1.50:389` | LDAP/AD server URL. Use `ldaps://` for TLS. |
| `AD_DOMAIN` | Yes | `CORP` | NetBIOS domain name (prepended as `CORP\username`). |
| `AD_BASE_DN` | No | `DC=corp,DC=local` | Base DN for user searches (reserved for future use). |
| `AD_TLS_REJECT_UNAUTHORIZED` | No | `false` | Set to `false` to accept self-signed TLS certs. |

**Example** (native):
```bash
AD_URL=ldap://10.0.1.50:389 AD_DOMAIN=CORP npm start
```

**Example** (Docker):
```bash
docker run -p 3000:3000 \
  -e AD_URL=ldaps://ad.corp.local:636 \
  -e AD_DOMAIN=CORP \
  --name dm deployment-manager
```

**Example** (Kubernetes):
```yaml
env:
  - name: AD_URL
    value: "ldap://ad-server.corp.svc.cluster.local:389"
  - name: AD_DOMAIN
    value: "CORP"
```

When `AD_URL` is set, the login page will show both a username and password field. Users authenticate against the AD server via LDAP bind. When `AD_URL` is not set, the app falls back to the original username-only login (useful for local development).

> **Security note:** When using `ldap://` (unencrypted), passwords are sent in plaintext to the LDAP server. Use `ldaps://` in production, or ensure the connection is over a trusted private network.

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

You can offload authentication to a Keycloak realm or any OpenID Connect (OIDC) identity provider. When OIDC is configured, the login screen displays a "Sign In with Keycloak" button which redirects the user to your realm login page.

To enable OIDC, set the following environment variables:

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `OIDC_ISSUER` | Yes | `http://localhost:8080/realms/myrealm` | The base URL of the Keycloak/OIDC realm. Enables OIDC mode. |
| `OIDC_CLIENT_ID` | Yes | `deployment-manager` | The Client ID configured in Keycloak. |
| `OIDC_REDIRECT_URI` | Yes | `http://localhost:3000/api/auth/oidc/callback` | The callback URL registered in Keycloak. |
| `OIDC_CLIENT_SECRET` | No | `your-client-secret` | The Client Secret. Only required for confidential clients; omit for public clients. |

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

All endpoints require authentication (via the JWT token in local storage).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Logs in or registers a user. Returns a token. |
| `GET` | `/api/auth/me` | Gets current user info. |
| `GET` | `/api/clusters` | Gets all clusters and deployments. |
| `POST` | `/api/reservations` | Creates a reservation. |
| `DELETE` | `/api/reservations/:id` | Releases a reservation. |
| `GET` | `/api/reservations/mine` | Gets reservations for the current user. |
| `GET` | `/api/reservations/active` | Gets all currently active reservations. |
| `GET` | `/api/history` | Gets full reservation history (Admin). |
| `POST` | `/api/admin/clusters` | Creates a new cluster (Admin). |
| `PUT` | `/api/admin/clusters/:id` | Updates a cluster (Admin). |
| `DELETE` | `/api/admin/clusters/:id` | Deletes a cluster and its deployments (Admin). |
| `POST` | `/api/admin/clusters/:id/deployments` | Adds a deployment to a cluster (Admin). |
| `DELETE` | `/api/admin/deployments/:id` | Deletes a deployment (Admin). |
| `GET` | `/api/admin/users` | Lists all users (Admin). |
| `PUT` | `/api/admin/users/:id/role` | Changes a user's role (Admin). |

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
