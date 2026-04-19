# Homebrew Tap for Keepr

This directory contains the Homebrew cask formula for Keepr. It is automatically
pushed to the [`keeprhq/homebrew-tap`](https://github.com/keeprhq/homebrew-tap)
repository on each release.

## Install

```bash
brew install --cask keeprhq/tap/keepr
```

This installs Keepr to `/Applications/Keepr.app` and symlinks the binary to
`/usr/local/bin/keepr` so the CLI and Claude Code plugin can find it.

## Update

```bash
brew upgrade --cask keepr
```

## Uninstall

```bash
brew uninstall --cask keepr
```

## Setup for the tap repo

The `keeprhq/homebrew-tap` repo needs:

1. A `Casks/` directory containing `keepr.rb`
2. A deploy key (`TAP_DEPLOY_KEY` secret in the main keepr repo) with write
   access to `keeprhq/homebrew-tap`

The release workflow automatically:
1. Builds the signed DMG
2. Computes its SHA256
3. Updates the version and SHA in `keepr.rb`
4. Pushes to `keeprhq/homebrew-tap`

### Creating the tap repo

```bash
# Create the repo on GitHub: keeprhq/homebrew-tap
# Then:
git clone git@github.com:keeprhq/homebrew-tap.git
cd homebrew-tap
mkdir Casks
cp /path/to/keepr/homebrew/keepr.rb Casks/
git add . && git commit -m "Initial cask" && git push
```

### Generating a deploy key

```bash
ssh-keygen -t ed25519 -C "keepr-tap-deploy" -f keepr-tap-key -N ""
# Add keepr-tap-key.pub as a deploy key (with write access) on keeprhq/homebrew-tap
# Add keepr-tap-key as TAP_DEPLOY_KEY secret on keeprhq/keepr
```
