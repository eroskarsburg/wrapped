# Wrapped shell integration for zsh, loaded instead of the user's .zshrc, which it then sources.

ZDOTDIR=$__wrapped_user_zdotdir
unset __wrapped_zdotdir __wrapped_user_zdotdir
if [[ "${WRAPPED_NO_PROFILE:-}" != "1" ]]; then
  # The shell is not a login one, but the user's .zprofile usually sets up PATH.
  [[ -f $ZDOTDIR/.zprofile ]] && source "$ZDOTDIR/.zprofile"
  [[ -f $ZDOTDIR/.zshrc ]] && source "$ZDOTDIR/.zshrc"
fi

autoload -Uz add-zsh-hook

__wrapped_hex() {
  printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n'
}

__wrapped_json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  # Control characters are invalid inside a JSON string.
  s=${s//$'\t'/\\t}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//[[:cntrl:]]/}
  printf '%s' "$s"
}

__wrapped_git_branch() {
  local dir=$PWD head
  while [[ -n $dir ]]; do
    local git=$dir/.git
    # Worktrees and submodules have a .git file that points to the real git directory.
    if [[ -f $git ]]; then
      read -r git < "$git"
      git=${git#gitdir: }
      [[ $git == /* || $git == [A-Za-z]:* ]] || git=$dir/$git
    fi
    if [[ -f $git/HEAD ]]; then
      read -r head < "$git/HEAD"
      case $head in
        "ref: refs/heads/"*) printf '%s' "${head#ref: refs/heads/}" ;;
        *) printf '%s' "${head:0:7}" ;;
      esac
      return
    fi
    [[ $dir == / ]] && return
    dir=${dir%/*}
    [[ -z $dir ]] && dir=/
  done
}

__wrapped_send_aliases() {
  local name json='' separator=''
  for name in ${(k)aliases}; do
    json+="$separator\"$(__wrapped_json_escape "$name")\":\"$(__wrapped_json_escape "${aliases[$name]}")\""
    separator=','
  done
  printf '\e]7777;%s\a' "$(__wrapped_hex "{\"aliases\":{$json}}")"
}

# Runs first among the precmd hooks, while $? still holds the command's status.
__wrapped_precmd() {
  local code=$?
  if [[ -n ${__wrapped_ran:-} ]]; then printf '\e]133;D;%s\a' "$code"; fi
  __wrapped_ran=
  local json
  json=$(printf '{"cwd":"%s","git":"%s","shell":"zsh","venv":"%s","user":"%s","host":"%s"}' \
    "$(__wrapped_json_escape "$PWD")" \
    "$(__wrapped_json_escape "$(__wrapped_git_branch)")" \
    "$(__wrapped_json_escape "${VIRTUAL_ENV:-}")" \
    "$(__wrapped_json_escape "${USER:-}")" \
    "$(__wrapped_json_escape "${HOST:-}")")
  printf '\e]7777;%s\a' "$(__wrapped_hex "$json")"
  if [[ -z ${__wrapped_aliases_sent:-} ]]; then
    __wrapped_aliases_sent=1
    __wrapped_send_aliases
  fi
  return $code
}

# Runs last, after hooks such as starship's have set their own PS1, and swaps in the markers.
__wrapped_prompt() {
  if [[ $PS1 != "$__wrapped_ps1" ]]; then __wrapped_user_ps1=$PS1; fi
  PS1=$__wrapped_ps1
  RPROMPT=
  RPS1=
  if [[ "${WRAPPED_HONOR_PROMPT:-}" == "1" ]]; then
    # (%%) also runs the substitutions of PROMPT_SUBST, which starship and oh-my-zsh rely on.
    local shown=${(%%)__wrapped_user_ps1}
    shown=$(printf '%s' "$shown" | sed 's/\x1b\[[0-9;]*[A-Za-z]//g; s/\x1b\][^\x07]*\x07//g' | tr -d '\033\r\n')
    printf '\e]7777;%s\a' "$(__wrapped_hex "{\"prompt\":\"$(__wrapped_json_escape "$shown")\"}")"
  fi
}

__wrapped_preexec() {
  __wrapped_ran=1
  printf '\e[2J\e[3J\e[H\e]133;C\a'
}

__wrapped_user_ps1=$PS1
__wrapped_ps1=$'%{\e]133;A\a\e]133;B\a%} '
PS1=$__wrapped_ps1
PS2=''
RPROMPT=
precmd_functions=(__wrapped_precmd ${precmd_functions:#__wrapped_*} __wrapped_prompt)
add-zsh-hook preexec __wrapped_preexec
