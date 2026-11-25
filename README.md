# Conversador

Intérprete de bolso: toque em quem vai falar, fale, faça uma pausa e ouça a tradução em voz alta.
Português ↔ Inglês, Espanhol, Francês, Italiano, Alemão, Chinês ou Japonês.

## App para telefone (`docs/`)

Página web instalável (PWA) que roda direto no navegador do celular:

- Microfone e voz do próprio telefone (Web Speech API): Chrome no Android, Safari no iPhone.
- A pausa encerra a fala (0,8 s a 3 s); com "ouvir o outro lado sozinho" ligado, o app alterna entre você e a outra pessoa.
- Tradução pelo Google Tradutor (endpoint público), com o MyMemory como reserva. Precisa de internet.
- Instalável na tela inicial ("Adicionar à Tela de Início" / "Instalar app").

Publicação: GitHub → Settings → Pages → Deploy from a branch → escolha o branch e a pasta `/docs`.
O microfone só funciona em HTTPS, que o GitHub Pages já fornece.

## Versão Claude (`index.html`)

Publicada como Artifact no claude.ai, usa ditado, tradução e voz do Claude.
Funciona no Chrome e no app Claude para computador; não no app de celular.
