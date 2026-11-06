# Contribuindo

## Ambiente

Requer Windows 10 1809 ou superior, Node.js LTS e Git.

```powershell
git clone https://github.com/eroskarsburg/wrapped.git
cd wrapped
npm ci
node node_modules/electron/install.js
npm run dev
```

O npm 11 bloqueia scripts de instalação, por isso o binário do Electron é baixado no segundo comando. O `node-pty` usa os prebuilds do pacote e não precisa de compilador C++.

## Fluxo de trabalho

1. Crie uma branch a partir de `main`: `feature/descricao` ou `fix/descricao`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
3. Abra um Pull Request para `main`. O CI precisa passar antes do merge.

## Build e testes

```powershell
npm run build      # typecheck e build
npm test           # testes unitários (Vitest)
npm run test:e2e   # end-to-end com PowerShell e Git Bash reais (Playwright), rode npm run build antes
```

Mudanças no protocolo de blocos (`resources/shell/`, `src/shared/oscRouter.ts`) devem ser testadas nos dois shells: o ConPTY reordena e repinta a saída de formas que testes unitários não mostram.

## Checklist de Pull Request

- [ ] A descrição explica o problema e a solução
- [ ] Testes adicionados ou atualizados
- [ ] Documentação atualizada, se o comportamento mudou
- [ ] CI verde

## Bugs e sugestões

Abra uma [issue](https://github.com/eroskarsburg/wrapped/issues) com versão do Windows, shell usado, passos para reproduzir, e o que era esperado.

Não copie código, temas ou marcas de outros terminais: o projeto é MIT e reimplementa os conceitos do zero.
