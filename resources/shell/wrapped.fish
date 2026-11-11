# Wrapped shell integration for fish. Loaded with --init-command, after the user's config.

function __wrapped_hex
    printf '%s' "$argv[1]" | od -An -v -tx1 | tr -d ' \n'
end

function __wrapped_escape
    # Control characters are invalid inside a JSON string.
    string replace -a '\\' '\\\\' -- "$argv[1]" | string replace -a '"' '\\"' \
        | string replace -a \t '\\t' | string replace -a \r '\\r' | string replace -ra '[[:cntrl:]]' '' \
        | string join '\\n'
end

function __wrapped_git_branch
    set -l dir $PWD
    while test -n "$dir"
        set -l git "$dir/.git"
        # Worktrees and submodules have a .git file that points to the real git directory.
        if test -f "$git"
            set git (string replace 'gitdir: ' '' -- (head -n1 "$git"))
            string match -qr '^(/|[A-Za-z]:)' -- $git || set git "$dir/$git"
        end
        if test -f "$git/HEAD"
            set -l head (head -n1 "$git/HEAD")
            if string match -q 'ref: refs/heads/*' -- $head
                string replace 'ref: refs/heads/' '' -- $head
            else
                string sub -l 7 -- $head
            end
            return
        end
        test "$dir" = / && return
        set dir (string replace -r '/[^/]*$' '' -- $dir)
        test -z "$dir" && set dir /
    end
end

function __wrapped_meta
    set -l json (printf '{"cwd":"%s","git":"%s","shell":"fish","venv":"%s","user":"%s","host":"%s"}' \
        (__wrapped_escape "$PWD") (__wrapped_escape (__wrapped_git_branch)) \
        (__wrapped_escape "$VIRTUAL_ENV") (__wrapped_escape "$USER") (__wrapped_escape "$hostname"))
    printf '\e]7777;%s\a' (__wrapped_hex "$json")
end

function __wrapped_preexec --on-event fish_preexec
    set -g __wrapped_ran 1
    printf '\e[2J\e[3J\e[H\e]133;C\a'
end

function __wrapped_postexec --on-event fish_postexec
    set -l code $status
    if set -q __wrapped_ran
        printf '\e]133;D;%s\a' $code
        set -e __wrapped_ran
    end
end

function fish_prompt
    __wrapped_meta
    printf '\e]133;A\a\e]133;B\a '
end

function fish_right_prompt
end

function fish_greeting
end
