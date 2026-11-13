# Estéreo

Player desktop em português, inspirado no fluxo de biblioteca e letras do [Liner Desktop](https://github.com/tryliner/desktop).

## Abrir

No terminal, nesta pasta, com Node.js 22.12 ou superior:

```powershell
npm install
npm start
```

## Catálogo online

O Estéreo abre em **Início** com faixas em destaque. Digite um título ou artista no campo de busca e clique numa faixa para tocar. A busca consulta resultados públicos de música e mostra até 28 faixas por pesquisa. A reprodução usa o player do Estéreo e requer conexão. Favoritas e faixas adicionadas a playlists ficam salvas na biblioteca.

## Usar a biblioteca local

1. Clique em **Importar** ou arraste os arquivos de áudio para a janela. O padrão **Artista - Título.ext** preenche os dois campos.
2. Para importar uma playlist M3U ou M3U8, selecione também os áudios que ela referencia. O app associa as entradas pelo nome do arquivo. Também é possível criar uma playlist e editar seus itens pelo menu das faixas.
3. Importe um LRC com o mesmo nome-base do áudio ou use **Vincular .lrc** na tela de letras. Clique em uma linha para avançar até ela. Use **−** e **+** para corrigir a sincronização em passos de 0,1 s.
4. Use **Espaço** para reproduzir ou pausar e **Esc** para voltar da tela de letras ou fechar a fila.

Os arquivos importados, as playlists, as favoritas e as letras são armazenados no perfil local do Electron. A fila vale para a sessão. As capas são ilustrações abstratas geradas pela interface. O projeto cobre reprodução local e letras sincronizadas por linha. Letras por sílaba, janela flutuante e Discord ficam fora desta versão.

## Importar do Spotify

Na **Biblioteca**, clique em **Importar link**, cole o link de uma playlist pública e clique em **Importar**. Abra a coleção e clique em **Reproduzir**. O Estéreo solicita a lista que o Spotify expõe no player público e salva os metadados localmente. Se você importar o mesmo link novamente, o app atualiza a coleção existente.

Os instaladores de Windows e Linux incluem o resolvedor de áudio. Ao executar o código-fonte com npm start, defina ESTEREO_YTDLP com o caminho para uma instalação do yt-dlp.

Ao tocar uma faixa, o Estéreo busca gravações por título, artista e duração no YouTube. O resolvedor fornece um endereço temporário de áudio para o player do Estéreo, que reproduz o áudio diretamente. Na tela de letras, use **Vincular .lrc** para sincronizar um arquivo de letra com a faixa em reprodução, inclusive uma faixa remota.

A importação inclui as faixas que o Spotify expõe no player público, que pode mostrar apenas parte de uma playlist longa. A busca e a resolução dependem das respostas dos serviços. Algumas gravações podem ficar indisponíveis.

A versão atual usa Electron. Para hospedar uma versão no Lovable, seria preciso portar a interface para o navegador e disponibilizar a importação e o resolvedor por uma API hospedada.


## Android

O APK usa a mesma interface para a biblioteca local, fila e letras. Para acessar o catálogo online, execute o servidor em um host com Node.js e yt-dlp e exponha-o via HTTPS. Defina ESTEREO_PUBLIC_ORIGIN com o endereço público e execute node server.cjs. Informe o mesmo endereço em Preferências → Configurar servidor. O APK da release usa assinatura de depuração para instalação manual.
