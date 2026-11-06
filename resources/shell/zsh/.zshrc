# Wrapped shell integration for zsh. ZDOTDIR points here, so the user's files load explicitly.

ZDOTDIR=$HOME
if [[ ${WRAPPED_NO_PROFILE:-} != 1 ]]; then
  [[ -f ~/.zshenv ]] && source ~/.zshenv
  [[ -f ~/.zprofile ]] && source ~/.zprofile
  [[ -f ~/.zshrc ]] && source ~/.zshrc
fi

__wrapped_hex() { printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n' }

__wrapped_json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

__wrapped_git_branch() {
  local dir=$PWD head
  while [[ -n $dir ]]; do
    if [[ -f $dir/.git/HEAD ]]; then
      read -r head < "$dir/.git/HEAD"
      printf '%s' "${head#ref: refs/heads/}"
      return
    fi
    [[ $dir == / ]] && return
    dir=${dir%/*}
    [[ -z $dir ]] && dir=/
  done
}

__wrapped_preexec() {
  __wrapped_ran=1
  printf '\033[2J\033[3J\033[H\033]133;C\007'
}

__wrapped_precmd() {
  local code=$?
  [[ -n ${__wrapped_ran:-} ]] && printf '\033]133;D;%s\007' "$code"
  __wrapped_ran=
  local json
  json=$(printf '{"cwd":"%s","git":"%s","shell":"zsh","venv":"%s","user":"%s","host":"%s"}' \
    "$(__wrapped_json_escape "$PWD")" "$(__wrapped_json_escape "$(__wrapped_git_branch)")" \
    "$(__wrapped_json_escape "${VIRTUAL_ENV:-}")" "$(__wrapped_json_escape "${USER:-}")" "$(__wrapped_json_escape "${HOST:-}")")
  printf '\033]7777;%s\007' "$(__wrapped_hex "$json")"
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec __wrapped_preexec
add-zsh-hook precmd __wrapped_precmd
PS1=$'%{\033]133;A\007\033]133;B\007%} '
RPS1=''
PS2=''
