# Code signing and notarization (macOS)

v1 can ship unsigned. If it does, users right-click the app and choose Open on first launch. That's a rough first impression. Once the Apple Developer enrollment clears, flip the release pipeline to signed and notarized and users get a normal double-click experience.

This doc walks through the whole setup once.

## 1. Enroll in the Apple Developer Program

- Go to <https://developer.apple.com/programs/enroll/>.
- Pay $99/year. An individual account is fine for v1; enrolling as an organization takes longer and requires a D-U-N-S number.
- Approval is typically 24–48 hours. Sometimes longer. Plan around it.

## 2. Create a Developer ID Application certificate

This is the cert macOS checks when a user opens the app. It's different from the "Apple Development" cert you'd use for Mac App Store distribution.

1. Open Keychain Access on the Mac you'll generate the cert on.
2. Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority.
3. Enter your Apple ID email. Pick "Saved to disk". Save the `.certSigningRequest` file.
4. Go to <https://developer.apple.com/account/resources/certificates>.
5. Click the plus icon, choose **Developer ID Application**, upload the CSR.
6. Download the `.cer` file and double-click it to install into Keychain Access.
7. In Keychain Access, find the cert under "login" → "My Certificates". Right-click → Export. Save as a `.p12` file. Set a password; remember it.

You now have two things:

- A `.p12` file containing the cert and private key
- A password for the `.p12` file

## 3. Create an app-specific password for notarization

Notarization uses your Apple ID but requires an app-specific password, not your real Apple ID password.

1. Go to <https://appleid.apple.com/account/manage>.
2. Sign in, scroll to "App-Specific Passwords", generate a new one called "keepr-notarize".
3. Copy the password. You will not see it again.

## 4. Find your Team ID

- Go to <https://developer.apple.com/account>, scroll to "Membership details".
- Copy the 10-character Team ID.

## 5. Configure GitHub Actions secrets

In the GitHub repo: Settings → Secrets and variables → Actions → New repository secret.

| Secret name                   | Value                                                  |
| ----------------------------- | ------------------------------------------------------ |
| `APPLE_CERTIFICATE`           | Base64-encoded contents of the `.p12` file             |
| `APPLE_CERTIFICATE_PASSWORD`  | The password you set when exporting the `.p12`        |
| `APPLE_SIGNING_IDENTITY`      | e.g. `Developer ID Application: Jane Doe (ABCDE12345)` |
| `APPLE_ID`                    | Your Apple ID email                                    |
| `APPLE_PASSWORD`              | The app-specific password from step 3                  |
| `APPLE_TEAM_ID`               | The 10-character team id from step 4                   |

To base64 the `.p12` file:

```bash
base64 -i keepr-signing.p12 | pbcopy
```

Paste the result into the `APPLE_CERTIFICATE` secret.

**Never commit the `.p12` file or any of these secrets to the repo.** Keep the `.p12` in a password manager alongside its password.

## 6. Verify the signing identity string

After installing the cert into Keychain Access, run:

```bash
security find-identity -v -p codesigning
```

You'll see something like:

```
1) ABCDEF1234567890 "Developer ID Application: Jane Doe (ABCDE12345)"
```

Copy the quoted string into `APPLE_SIGNING_IDENTITY`.

## 7. Cut a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `.github/workflows/release.yml` workflow detects the tag and checks for signing secrets. If all six secrets are present, it signs and notarizes the build. If any are missing, it falls back to an unsigned build and labels the GitHub Release accordingly. Either way, you get a draft release with the `.dmg` attached. Review the release notes, then publish.

Notarization typically adds 5–10 minutes to the build. If notarization fails, the workflow fails with the stapler error — the most common causes are a missing hardened runtime entitlement or a Tauri plugin that ships an unsigned binary. Re-run with the logs open.

## Unsigned fallback instructions (for users)

If the release is unsigned, add this to the release notes so users aren't stuck:

> **First launch on macOS:**
>
> 1. Drag Keepr to your Applications folder.
> 2. Right-click (or Control-click) the Keepr icon and choose **Open**.
> 3. macOS will warn you the developer is unidentified. Click **Open** on the dialog.
> 4. After the first launch, Keepr opens normally on double-click.
>
> If you see "Keepr is damaged and can't be opened" instead of the unidentified developer dialog, run this in Terminal once:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Keepr.app
> ```
>
> This removes the quarantine bit that macOS adds to files downloaded from the internet. It does not bypass any security checks you'd get from a signed build — it just tells Gatekeeper to let you try.

## When to flip to signed

As soon as the Apple Developer enrollment clears and you've added the six secrets, the next `v*` tag pushes a signed build automatically. No workflow changes required.

---

## Tauri auto-update signing (independent of Apple notarization)

Keepr's auto-updater plugin (Tauri v2) verifies every downloaded bundle against a signing public key embedded in the binary. This is a separate trust chain from Apple code signing — it lets the app refuse a malicious bundle that somehow lands at our GitHub Releases URL. Both signatures are independent: the app can be Apple-signed-and-notarized, Tauri-signed, both, or (today) only Tauri-signed. The auto-updater requires Tauri signing regardless of Apple status.

### One-time keypair generation

Run this once on a developer machine you trust. The private key never leaves that machine — it gets uploaded to GitHub Actions as a secret, not committed.

```bash
mkdir -p ~/.tauri
npx @tauri-apps/cli signer generate -w ~/.tauri/keepr-updater.key
# Choose a strong password when prompted. Save it somewhere safe (1Password, etc).
```

The command prints two things:

1. **Public key** — paste this into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, replacing the `REPLACE_ME_WITH_TAURI_SIGNER_PUBLIC_KEY` placeholder.
2. **Private key path** — `~/.tauri/keepr-updater.key`. Do NOT commit this file.

### GitHub Actions secrets

Set both in the repo's Settings → Secrets and variables → Actions:

- `TAURI_SIGNING_PRIVATE_KEY` — paste the **contents** of `~/.tauri/keepr-updater.key` (not the path)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose above

`tauri-action` picks both up automatically when `bundle.createUpdaterArtifacts` is `true` in `tauri.conf.json` (already set). The CI build emits `Keepr.app.tar.gz`, `.sig`, and `latest.json` alongside the DMG, all attached to the GitHub Release.

### Key rotation

If the private key is ever compromised:

1. Generate a new keypair (same `signer generate` command).
2. Update both GitHub secrets.
3. Update `pubkey` in `tauri.conf.json` and ship a new release.

Existing installs running with the old pubkey will refuse the new bundle — those users have to upgrade once via Homebrew or DMG to pick up the new pubkey, then auto-update resumes. Same one-time-tax dynamic as the original updater bootstrap.

### Why this matters

Without Tauri signing, anyone who can publish to our GitHub Releases (compromised CI, social-engineered maintainer) could push a malicious bundle that every Keepr user auto-installs. With it, the bundle is rejected unless the signature matches a key only we hold. This is the entire reason Tauri requires signed updater bundles by default.
