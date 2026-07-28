# Security Notes

## How This Tool Works

Tunnel Digger runs **entirely in your browser**. No data is sent to any server — your API tokens, Tailscale keys, and configuration choices stay on your machine. The generated files are bundled into a zip and downloaded directly.

You can verify this by opening your browser's Network tab — you'll see requests only to:
- CDN resources (Leaflet map library, JSZip, map tiles, country borders GeoJSON)
- Your cloud provider's template files (loaded locally from the same site)

No outbound requests carry your credentials.

## What Gets Generated

| File | Contains Secrets? | Git-Safe? |
|------|------------------|-----------|
| `main.tf` | No | Yes |
| `variables.tf` | No | Yes |
| `cloud-init.yaml` | No (uses Terraform variable reference) | Yes |
| `terraform.tfvars.example` | No (placeholders only) | Yes |
| `terraform.tfvars` | **YES** (API token + Tailscale key) | **NO** |
| `.tfstate` / `.tfstate.backup` | **YES** (may contain secrets) | **NO** |
| `deploy.sh` / `deploy.ps1` | No | Yes |
| `.gitignore` | No | Yes |
| `README.md` | No | Yes |

## The "I Don't Trust You" Option

If you choose "I don't trust you" on the credentials step, your download will contain placeholder values (`PASTE_YOUR_TAILSCALE_AUTH_KEY_HERE` and `PASTE_YOUR_PROVIDER_API_TOKEN_HERE`) in `terraform.tfvars`. You can then open the file in a text editor and paste your real tokens directly — the browser never sees them.

## .gitignore

The generated `.gitignore` excludes:
- `terraform.tfvars` (contains real credentials)
- `.terraform/` (provider binaries)
- `*.tfstate` and `*.tfstate.backup` (may contain secrets in state)

## Recommended Workflow

1. Download and extract the zip
2. If you used the "I don't trust you" option, open `terraform.tfvars` in a text editor and replace the placeholders
3. Run `./deploy.sh` (Linux/macOS) or `.\deploy.ps1` (Windows)
4. The script checks Terraform is installed, runs init/plan, confirms before applying
5. After deploy, approve the exit node in Tailscale Admin Console
6. Set up billing alerts in your cloud provider's console
7. When finished, run `terraform destroy` to stop billing

## If You Need More Security

### Environment Variables Instead of tfvars

Instead of storing tokens in a file, export them as environment variables:

```bash
export TF_VAR_provider_api_token="your-token"
export TF_VAR_tailscale_auth_key="tskey-auth-..."
terraform plan
terraform apply
```

### Remote State

For team use, consider storing Terraform state in a remote backend (S3, Terraform Cloud, etc.) rather than locally, to avoid secrets in `.tfstate` files on disk.

### Token Scoping

Create the minimum-privilege API token for your provider:
- **Hetzner**: Read/Write on Servers only
- **DigitalOcean**: Read/Write on Droplets (and Monitoring if using billing alerts)
- **Linode**: Read/Write on Linodes only

Revoke the token after you're done if you don't plan to manage the VM further.

## Rotating Credentials

- Rotate your Tailscale auth key periodically (they can be set to expire)
- If you suspect your provider API token is compromised, revoke it immediately in the provider's console and generate a new one
