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
