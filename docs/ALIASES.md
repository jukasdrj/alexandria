# Shell Aliases & Commands Reference

**Last Updated:** December 27, 2025  
**Primary Shell:** zsh (Oh My Zsh + Powerlevel10k)

---

## 🖥️ SSH Aliases

Defined in `~/.ssh/config`:

### Green (WSL2 Dev Server)
```bash
Host green
    HostName 100.104.253.23
    User justin
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
```

**Usage:**
```bash
ssh green              # Connect to Green
ssh green "command"    # Run command remotely
```

### Tower (Unraid Server)
```bash
Host tower
    HostName 100.120.125.46
    User root
    IdentityFile ~/.ssh/id_ed25519
    # Local IP fallback: 192.168.1.240
```

**Usage:**
```bash
ssh tower              # Connect to Tower (may need Tailscale browser auth)
ssh tower "command"    # Run command remotely
```

---

## 🤖 Claude Code Aliases

Defined in `~/.zshrc`:

### `cc` - Local Claude Code (Mac)
```bash
alias cc="claude --dangerously-skip-permissions"
```

**Usage:** Run from any repo on Mac for iOS/Swift development
```bash
cd ~/dev_repos/books-v3
cc
```

### `ccg` - Remote Claude Code (Green)
```bash
ccg() {
  echo "📂 Select repo on green:"
  echo "  1) bendv3"
  echo "  2) alexandria"
  echo "  3) books-flutter"
  echo -n "Choice [1-3]: "
  read choice
  case $choice in
    1) repo="bendv3" ;;
    2) repo="alexandria" ;;
    3) repo="books-flutter" ;;
    *) echo "Invalid choice"; return 1 ;;
  esac
  ssh -t green "cd ~/dev_repos/$repo && PATH=\$HOME/.npm-global/bin:/snap/bin:\$PATH claude --dangerously-skip-permissions"
}
```

**Usage:** Interactive repo picker for backend/Flutter development
```bash
ccg
# Select 1, 2, or 3
```

---

## 🔄 Development Aliases

### `devup` - Update All Dev Tools
```bash
alias devup='echo "🔄 Updating Homebrew..." && brew update && brew upgrade && brew cleanup && echo "🔄 Updating npm global packages..." && npm update -g && echo "🔄 Updating Flutter..." && flutter upgrade && echo "🔄 Updating Oh My Zsh..." && omz update && echo "✅ All updates complete!"'
```

**Usage:** Run periodically to keep tools updated
```bash
devup
```

---

## 📍 Quick Reference Table

| Alias/Command | Location | Purpose |
|---------------|----------|---------|
| `cc` | Mac | Claude Code for local Swift/Xcode dev |
| `ccg` | Mac → Green | Claude Code for remote backend/Flutter dev |
| `ssh green` | Mac | SSH to WSL2 dev server |
| `ssh tower` | Mac | SSH to Unraid server |
| `devup` | Mac | Update Homebrew, npm, Flutter, Oh My Zsh |

---

## 🛠️ Common Workflows

### iOS Development (Mac)
```bash
cd ~/dev_repos/books-v3
cc
```

### Backend Development (Green)
```bash
ccg
# Select 1 for bendv3
```

### Database Access (Tower)
```bash
ssh tower "docker exec -it postgres psql -U openlibrary -d openlibrary"
```

### Check All Services
```bash
ssh tower "docker ps --format 'table {{.Names}}\t{{.Status}}'"
```

### Tunnel Status
```bash
ssh tower "docker logs alexandria-tunnel --tail 20"
```

### Worker Deployment
```bash
# Alexandria
cd ~/dev_repos/alex/worker && npm run deploy

# Bend
cd ~/dev_repos/bendv3 && npm run deploy
```

### Fix NFS Permission Issues
```bash
# Quick fix for Docker container permission problems
cd ~/dev_repos/alex/scripts
./fix-nfs-permissions.sh qbittorrent /mnt/user/data/adult/torrents_incoming

# Or for any container/path
./fix-nfs-permissions.sh [container_name] [path_on_tower]
```

### Mount Tower NFS Shares (Mac)
```bash
# Shares auto-mount on access
ls /Tower/domains
ls /Tower/data

# Manually trigger mount
sudo automount -vc

# Check mount status
nfsstat -m | grep Tower
```

---

## 📂 Path Configuration

Defined in `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"           # Claude CLI, pipx tools
export PATH="$HOME/Library/Python/3.9/bin:$PATH"
export PATH="/Users/juju/.antigravity/antigravity/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
```

### Key Binaries in `~/.local/bin/`
| Binary | Points To |
|--------|-----------|
| `claude` | `~/.local/share/claude/versions/2.0.76` |
| `idb` | pipx venv (iOS debugging) |
| `idb-mcp` | pipx venv (MCP server) |

---

## 🔧 Adding New Aliases

Edit `~/.zshrc`:
```bash
nano ~/.zshrc
# Add your alias
source ~/.zshrc  # Reload
```

Edit SSH config:
```bash
nano ~/.ssh/config
# Add new Host block
```

---

## 📝 Files Reference

| File | Purpose |
|------|---------|
| `~/.zshrc` | Shell aliases, functions, PATH |
| `~/.ssh/config` | SSH host aliases |
| `~/.p10k.zsh` | Powerlevel10k prompt config |
| `~/dev_repos/repos.md` | Repository quick reference |

---

## 📝 Version History

| Date | Change |
|------|--------|
| 2026-01-06 | Added NFS mount commands and fix-nfs-permissions.sh script |
| 2025-12-27 | Initial documentation |
