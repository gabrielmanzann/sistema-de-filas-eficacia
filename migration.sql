-- Use SOMENTE se já executou a versão antiga do projeto, que continha
-- usuarios(email, perfil) e usava AUDITOR como perfil.
-- Faça backup antes de executar qualquer migração em ambiente produtivo.
-- Execute este arquivo já conectado ao banco antigo correto.

ALTER TABLE usuarios
  MODIFY COLUMN perfil ENUM('AUDITOR', 'FUNCIONARIO', 'GESTOR') NOT NULL;

UPDATE usuarios SET perfil = 'FUNCIONARIO' WHERE perfil = 'AUDITOR';

ALTER TABLE usuarios
  CHANGE COLUMN perfil tipo_usuario ENUM('FUNCIONARIO', 'GESTOR') NOT NULL,
  ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- O e-mail legado pode continuar na tabela sem ser usado. Esta chave impede
-- logins duplicados por nome; resolva nomes duplicados antes desta instrução.
ALTER TABLE usuarios ADD UNIQUE KEY uq_usuarios_nome (nome);
