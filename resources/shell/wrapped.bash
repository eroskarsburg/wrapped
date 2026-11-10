# Wrapped shell integration for bash (Git Bash, MSYS2, WSL).
# Started with --rcfile, so it loads the user's own startup files itself.

if [ "${WRAPPED_NO_PROFILE:-}" != "1" ]; then
  if [ -f ~/.bash_profile ]; then . ~/.bash_profile
  elif [ -f ~/.bash_login ]; then . ~/.bash_login
  elif [ -f ~/.profile ]; then . ~/.profile
  elif [ -f ~/.bashrc ]; then . ~/.bashrc
  fi
fi

__wrapped_hex() {
  # od is available in Git Bash, MSYS2 and any WSL distro.
  printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n'
}

__wrapped_json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  # Control characters are invalid inside a JSON string: a tab in a directory name would make
  # the UI drop the whole message and keep showing the previous directory.
  s=${s//$'\t'/\\t}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//[[:cntrl:]]/}
  printf '%s' "$s"
}

__wrapped_git_branch() {
  local dir=$PWD head
  while [ -n "$dir" ]; do
    local git=$dir/.git
    # Worktrees and submodules have a .git file that points to the real git directory.
    if [ -f "$git" ]; then
      read -r git < "$git"
      git=${git#gitdir: }
      case $git in /*|[A-Za-z]:*) ;; *) git=$dir/$git ;; esac
    fi
    if [ -f "$git/HEAD" ]; then
      read -r head < "$git/HEAD"
      case $head in
        "ref: refs/heads/"*) printf '%s' "${head#ref: refs/heads/}" ;;
        *) printf '%s' "${head:0:7}" ;;
      esac
      return
    fi
    [ "$dir" = "/" ] && return
    dir=${dir%/*}
    [ -z "$dir" ] && dir=/
  done
}

__wrapped_cwd() {
  # Native path, so that the UI can use it with the filesystem directly.
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$PWD"
  elif [ -n "${WSL_DISTRO_NAME:-}" ]; then printf '\\\\wsl.localhost\\%s%s' "$WSL_DISTRO_NAME" "${PWD//\//\\}"
  else printf '%s' "$PWD"
  fi
}

# First in PROMPT_COMMAND, while $? still holds the command's status.
__wrapped_precmd() {
  local code=$?
  if (( ${__wrapped_ran:-0} > 0 )); then printf '\033]133;D;%s\007' "$code"; fi
  __wrapped_ran=0
  local json
  json=$(printf '{"cwd":"%s","git":"%s","shell":"bash","venv":"%s","user":"%s","host":"%s"}' \
    "$(__wrapped_json_escape "$(__wrapped_cwd)")" \
    "$(__wrapped_json_escape "$(__wrapped_git_branch)")" \
    "$(__wrapped_json_escape "${VIRTUAL_ENV:-}")" \
    "$(__wrapped_json_escape "${USER:-${USERNAME:-}}")" \
    "$(__wrapped_json_escape "${HOSTNAME:-}")")
  printf '\033]7777;%s\007' "$(__wrapped_hex "$json")"
  if [ -z "${__wrapped_aliases_sent:-}" ]; then
    __wrapped_aliases_sent=1
    __wrapped_send_aliases
  fi
  # The user's own hooks come next and expect the status of the command, not ours.
  return "$code"
}

# Last in PROMPT_COMMAND: whatever PS1 the user's hooks set (starship rewrites it every time) is
# kept for the "shell" prompt mode and replaced by the markers.
__wrapped_prompt() {
  if [ "$PS1" != "$__wrapped_ps1" ]; then __wrapped_user_ps1=$PS1; fi
  PS1=$__wrapped_ps1
  if [ "${WRAPPED_HONOR_PROMPT:-}" = "1" ]; then
    # Control characters are not valid inside a JSON string, and the UI shows plain text anyway.
    local shown json
    shown=$(printf '%s' "${__wrapped_user_ps1@P}" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\x1b\][^\x07]*\x07//g' | tr -d '\001\002\033\r\n')
    json=$(printf '{"prompt":"%s"}' "$(__wrapped_json_escape "$shown")")
    printf '\033]7777;%s\007' "$(__wrapped_hex "$json")"
  fi
}

__wrapped_send_aliases() {
  local line name value json='' separator=''
  while IFS= read -r line; do
    line=${line#alias }
    name=${line%%=*}
    value=${line#*=}
    value=${value#\'}
    value=${value%\'}
    json+="$separator\"$(__wrapped_json_escape "$name")\":\"$(__wrapped_json_escape "$value")\""
    separator=','
  done < <(alias -p)
  printf '\033]7777;%s\007' "$(__wrapped_hex "{\"aliases\":{$json}}")"
}

__wrapped_user_ps1=$PS1
__wrapped_ps1=$'\[\033]133;A\007\033]133;B\007\] '
PS1=$__wrapped_ps1
PS2=''
# PS0 expands in this shell right after a line is accepted, and once more for each further command
# of a pasted multi-line script. The arithmetic subscript runs in this shell too: it counts the
# expansions, so the clear and the C marker come out the first time only (one block per line),
# and the count tells the next prompt that something ran. The user's own PS0 stays in front:
# starship times commands with it.
__wrapped_start=($'\033[2J\033[3J\033[H\033]133;C\007')
PS0=${PS0:-}'${__wrapped_start[__wrapped_ran++]}'
# The user's hooks (mise, direnv, starship, zoxide) stay in PROMPT_COMMAND, where tools such as
# zoxide look for them, between the two functions above.
if [ "${BASH_VERSINFO[0]}" -gt 5 ] || { [ "${BASH_VERSINFO[0]}" -eq 5 ] && [ "${BASH_VERSINFO[1]}" -ge 1 ]; }; then
  # Bash 5.1 runs each element of an array with the status of the last command.
  PROMPT_COMMAND=(__wrapped_precmd "${PROMPT_COMMAND[@]}" __wrapped_prompt)
else
  PROMPT_COMMAND="__wrapped_precmd"$'\n'"${PROMPT_COMMAND:-}"$'\n'"__wrapped_prompt"
fi
bind 'set enable-bracketed-paste on' 2>/dev/null
