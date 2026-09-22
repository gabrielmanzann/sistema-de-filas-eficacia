-- Instalação nova. Execute este arquivo em um MySQL 8+ antes de iniciar a API.
CREATE DATABASE IF NOT EXISTS fila_auditoria_eficacia
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fila_auditoria_eficacia;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL,
  senha VARCHAR(255) NOT NULL,
  tipo_usuario ENUM('FUNCIONARIO', 'GESTOR') NOT NULL DEFAULT 'FUNCIONARIO',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fila_auditoria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  posicao INT NOT NULL,
  status ENUM('AGUARDANDO', 'EM_ANDAMENTO') NOT NULL DEFAULT 'AGUARDANDO',
  data_entrada TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fila_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  UNIQUE KEY uq_fila_usuario (usuario_id),
  UNIQUE KEY uq_fila_posicao (posicao)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auditorias_concluidas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  data_conclusao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_concluida_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  KEY idx_concluidas_data_usuario (data_conclusao, usuario_id)
) ENGINE=InnoDB;

-- Os hashes SHA-256 abaixo são somente para os dados iniciais. No primeiro
-- login a API os converte automaticamente para o hash seguro do Werkzeug.
INSERT INTO usuarios (nome, senha, tipo_usuario) VALUES
  ('Agata', SHA2('123', 256), 'FUNCIONARIO'),
  ('Ricardo', SHA2('123', 256), 'FUNCIONARIO'),
  ('Maria', SHA2('123', 256), 'FUNCIONARIO'),
  ('Gestor', SHA2('123', 256), 'GESTOR')
ON DUPLICATE KEY UPDATE nome = VALUES(nome);

INSERT IGNORE INTO fila_auditoria (usuario_id, posicao, status)
SELECT id, 1, 'EM_ANDAMENTO' FROM usuarios WHERE nome = 'Agata';
INSERT IGNORE INTO fila_auditoria (usuario_id, posicao, status)
SELECT id, 2, 'AGUARDANDO' FROM usuarios WHERE nome = 'Ricardo';
INSERT IGNORE INTO fila_auditoria (usuario_id, posicao, status)
SELECT id, 3, 'AGUARDANDO' FROM usuarios WHERE nome = 'Maria';
