# Wrapped shell integration for Windows PowerShell / PowerShell 7.
# Loaded with -NoProfile -NoExit -File, so it loads the user's profile itself.

$script:WrappedEsc = [char]0x1b
$script:WrappedBel = [char]0x07

function global:__Wrapped-Osc([string]$Payload) {
    [Console]::Out.Write("$script:WrappedEsc]$Payload$script:WrappedBel")
}

function global:__Wrapped-Meta([hashtable]$Data) {
    $json = ConvertTo-Json -InputObject $Data -Compress
    $hex = [BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($json)).Replace('-', '')
    __Wrapped-Osc "7777;$hex"
}

function global:__Wrapped-GitBranch {
    $dir = (Get-Location -PSProvider FileSystem).ProviderPath
    while ($dir) {
        $head = Join-Path $dir '.git\HEAD'
        if (Test-Path -LiteralPath $head -PathType Leaf) {
            $text = (Get-Content -LiteralPath $head -TotalCount 1 -ErrorAction SilentlyContinue)
            if ($text -match '^ref: refs/heads/(.+)$') { return $Matches[1] }
            if ($text) { return $text.Substring(0, [Math]::Min(7, $text.Length)) }
            return ''
        }
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
    }
    return ''
}

# Runs the user's profile before hooks are installed, so that hooks wrap whatever it configured.
if ($env:WRAPPED_NO_PROFILE -ne '1') {
    foreach ($candidate in @($PROFILE.AllUsersAllHosts, $PROFILE.AllUsersCurrentHost, $PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            try { . $candidate } catch { Write-Host "wrapped: erro ao carregar ${candidate}: $_" }
        }
    }
}

$script:WrappedUserPrompt = $function:global:prompt
$script:WrappedRanCommand = $false
$script:WrappedNativeBefore = $global:LASTEXITCODE

if (Get-Module PSReadLine) {
    # PSReadLine 2.0, shipped with Windows PowerShell 5.1, has no predictions.
    if ((Get-Command Set-PSReadLineOption).Parameters.ContainsKey('PredictionSource')) {
        Set-PSReadLineOption -PredictionSource None
    }
    Set-PSReadLineOption -BellStyle None -ErrorAction SilentlyContinue
    Set-PSReadLineOption -EditMode Emacs -ErrorAction SilentlyContinue
    # Bare continuation prompt keeps the discarded echo region trivially small.
    Set-PSReadLineOption -ContinuationPrompt '' -ErrorAction SilentlyContinue

    # The UI sends newlines of a multi-line command as this chord instead of Enter.
    Set-PSReadLineKeyHandler -Chord 'Alt+j' -Function AddLine

    $script:WrappedReadLine = $function:global:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {
        $line = & $script:WrappedReadLine
        $script:WrappedRanCommand = $true
        $script:WrappedNativeBefore = $global:LASTEXITCODE
        # Clears the ConPTY grid so the block's own xterm starts in the same state at 0,0.
        [Console]::Out.Write("$script:WrappedEsc[2J$script:WrappedEsc[3J$script:WrappedEsc[H")
        __Wrapped-Osc '133;C'
        $line
    }
}

function global:prompt {
    $ok = $global:?
    $native = $global:LASTEXITCODE
    # LASTEXITCODE survives PowerShell-only failures, so it only counts when the command changed it.
    $code = if ($ok) { 0 } elseif ($native -and $native -ne $script:WrappedNativeBefore) { $native } else { 1 }
    if ($script:WrappedRanCommand) { __Wrapped-Osc "133;D;$code" }
    $script:WrappedRanCommand = $false
    $cwd = (Get-Location -PSProvider FileSystem).ProviderPath
    __Wrapped-Meta @{ cwd = $cwd; git = (__Wrapped-GitBranch); shell = 'powershell'; venv = "$env:VIRTUAL_ENV"; user = "$env:USERNAME"; host = "$env:COMPUTERNAME" }
    if (-not $script:WrappedAliasesSent) {
        $script:WrappedAliasesSent = $true
        $aliases = @{}
        foreach ($alias in Get-Alias) { $aliases[$alias.Name] = $alias.Definition }
        __Wrapped-Meta @{ aliases = $aliases }
    }
    $global:LASTEXITCODE = $native
    __Wrapped-Osc '133;A'
    $text = if ($env:WRAPPED_HONOR_PROMPT -eq '1') { & $script:WrappedUserPrompt } else { '' }
    __Wrapped-Meta @{ prompt = "$text" }
    __Wrapped-Osc '133;B'
    ' '
}
