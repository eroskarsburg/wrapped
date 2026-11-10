# Wrapped shell integration for zsh. ZDOTDIR points here so that zsh reads these files first;
# each one hands over to the user's own file in their real ZDOTDIR.

__wrapped_zdotdir=$ZDOTDIR
ZDOTDIR=${WRAPPED_USER_ZDOTDIR:-$HOME}
[[ "${WRAPPED_NO_PROFILE:-}" != "1" && -f $ZDOTDIR/.zshenv ]] && source "$ZDOTDIR/.zshenv"
__wrapped_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__wrapped_zdotdir
