/** Shared vocabulary: labels, consent texts and bounty templates from FUNLABS.md. */

export const STUDY_FLOW = ['draft', 'published', 'collecting', 'analyzing', 'evidence_ready', 'comparing', 'completed'] as const;
export type StudyStatus = (typeof STUDY_FLOW)[number] | 'archived';

export const STATUS_LABEL: Record<StudyStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  collecting: 'Recibiendo material',
  analyzing: 'Analizando',
  evidence_ready: 'Evidencia lista',
  comparing: 'Comparación en curso',
  completed: 'Completado',
  archived: 'Archivado',
};

export const OBJECTIVE_LABEL: Record<string, string> = {
  clarity: 'Claridad',
  fun: 'Diversión',
  challenge: 'Desafío',
  pacing: 'Ritmo',
  controls: 'Respuesta de controles',
};

/** What each objective collects, fixed before the study (FUNLABS.md §4). */
export const OBJECTIVE_MEASURE: Record<string, string> = {
  clarity: 'Comprensión declarada y evidencia de que la persona realizó la tarea.',
  fun: 'Preferencia y motivo declarado.',
  challenge: 'Dificultad declarada, intentos y si la persona quiere conservar el desafío.',
  pacing: 'Momentos de espera o aceleración declarados y observados.',
  controls: 'Acciones que no respondieron como la persona esperaba.',
};

export const CATEGORY_LABEL: Record<string, string> = {
  clarity: 'Claridad',
  difficulty: 'Dificultad',
  enjoyment: 'Disfrute',
  controls: 'Controles',
  pacing: 'Ritmo',
  bug: 'Error',
  other: 'Otro',
};

export const REVIEW_LABEL: Record<string, string> = {
  unreviewed: 'Sin revisar',
  confirmed: 'Confirmado',
  corrected: 'Corregido',
  rejected: 'Rechazado',
};

export const STRUCTURAL_LABEL: Record<string, string> = {
  verified: 'Fuentes verificadas',
  partial: 'Fuentes parciales',
  unsupported: 'Sin fuente verificable: hipótesis',
};

export const ORIGIN_LABEL: Record<string, string> = {
  model: 'Gemini',
  human: 'Persona del equipo',
  agent: 'Agente participante',
};

export const BOUNTY_KIND_LABEL: Record<string, string> = {
  human_playtest: 'Humano: experimentar y explicar',
  agent_prediction: 'Agente: predecir una preferencia',
  agent_analysis: 'Agente: analizar evidencia',
  agent_intervention: 'Agente: proponer y comprobar una mejora',
};

export const FINAL_QUESTIONS = [
  { key: 'enjoyed', text: '¿Qué disfrutaste?' },
  { key: 'confusing', text: '¿Dónde no supiste cómo seguir o qué te costó entender?' },
  { key: 'change', text: '¿Qué cambiarías?' },
] as const;

/** Labels are tied to the presentation position, never to version A or B. */
export const NEUTRAL_LABELS = ['Versión Ámbar', 'Versión Celeste'] as const;

export const CONSENT_TEXTS = {
  participation_recording: {
    version: 'participacion-v1',
    text:
      'Acepto participar en esta prueba privada y que se grabe solo la pestaña del juego mientras juego. El micrófono es opcional y no se usa cámara. Puedo detener la grabación en cualquier momento y elegir la alternativa escrita.',
  },
  research_sharing: {
    version: 'investigacion-v1',
    text:
      'Opcional. Permito que eventos de la partida, mis comentarios y hallazgos revisados de esta prueba se incluyan en un export privado para investigación. El video no se incluye salvo autorización aparte. Puedo retirar este permiso antes de cada export.',
  },
  model_training: {
    version: 'entrenamiento-v1',
    text: 'Opcional y separado. Permito que esos mismos datos se usen para entrenar o evaluar modelos.',
  },
} as const;

export const CREATOR_CONSENT_TEXT = {
  version: 'creador-investigacion-v1',
  text:
    'Como titular del producto, autorizo que los ejemplos de este estudio que tengan permiso de cada participante y estén revisados se incluyan en un export privado para investigación.',
};

export type BountyTemplate = {
  kind: 'human_playtest' | 'agent_prediction' | 'agent_analysis' | 'agent_intervention';
  title: string;
  instructions: string;
  deliverable: string;
  criteria: string[];
};

export const BOUNTY_TEMPLATES: Record<BountyTemplate['kind'], BountyTemplate> = {
  human_playtest: {
    kind: 'human_playtest',
    title: 'Jugar y explicar',
    instructions: 'Jugá esta experiencia durante dos minutos. Contanos qué disfrutaste y dónde no supiste cómo seguir.',
    deliverable: 'Grabación de la pestaña, comentario de voz opcional o escrito, respuestas finales y comparación de versiones cuando corresponda.',
    criteria: [
      'Material utilizable: grabación o alternativa escrita.',
      'Realizó la tarea pedida.',
      'Comentarios relacionados con la partida.',
      'Decir que algo es aburrido, elegir la versión anterior o no tener preferencia son entregas válidas.',
      'No se paga por comentarios positivos ni por coincidir con otras personas.',
    ],
  },
  agent_prediction: {
    kind: 'agent_prediction',
    title: 'Predecir una preferencia',
    instructions: 'Para este público y estas dos versiones, anticipá cuál se preferirá, por qué y con qué incertidumbre.',
    deliverable: 'Una elección (una versión o sin preferencia), los motivos y la incertidumbre, registrada antes de ver resultados humanos.',
    criteria: [
      'Se registra con fecha antes de revelar resultados. Si el agente ya los vio, cuenta como análisis retrospectivo.',
      'Se compara con las preferencias humanas, incluyendo desacuerdo y ausencia de preferencia.',
      'Un acierto aislado o una muestra pequeña no demuestran juicio general.',
    ],
  },
  agent_analysis: {
    kind: 'agent_analysis',
    title: 'Analizar evidencia',
    instructions: 'Encontrá momentos donde las instrucciones fueron difíciles de entender. Adjuntá el intervalo y la fuente que sostienen cada hallazgo.',
    deliverable: 'Observaciones, comentarios relacionados, hipótesis e indicaciones de qué conviene conservar.',
    criteria: [
      'Correspondencia con el material.',
      'Intervalos dentro de la grabación.',
      'Citas verificables: cada cita referencia un comentario real.',
      'Cobertura de las sesiones disponibles.',
      'Separación entre observación e interpretación.',
      'La opinión de otro modelo no es la única referencia.',
    ],
  },
  agent_intervention: {
    kind: 'agent_intervention',
    title: 'Proponer y comprobar una mejora',
    instructions: 'Mejorá la claridad del comienzo manteniendo el desafío. Entregá una variante y explicá qué evidencia motivó el cambio.',
    deliverable: 'Versión ejecutable, cambio trazable y comprobaciones de funcionamiento. La preferencia humana posterior se registra por separado.',
    criteria: [
      'Solo cambia regiones editables: niveles y reglas quedan idénticos.',
      'Pasa las comprobaciones fijadas antes del cambio.',
      'Cita la evidencia que lo motivó y dice qué conserva.',
    ],
  },
};

export const CAPABILITIES = {
  'evidence:read': 'Consultar estudios y evidencia del producto',
  'study:create': 'Preparar estudios en borrador',
  'study:publish': 'Publicar estudios dentro de la política de gasto',
  'work:submit': 'Entregar predicciones, análisis o intervenciones',
  'results:read': 'Ver preferencias humanas (marca predicciones posteriores como retrospectivas)',
  'export:request': 'Pedir exports privados de investigación',
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const CREATOR_AGENT_CAPABILITIES: Capability[] = ['evidence:read', 'study:create', 'study:publish', 'work:submit', 'results:read', 'export:request'];
export const PREDICTION_AGENT_CAPABILITIES: Capability[] = ['evidence:read', 'work:submit'];
export const ANALYSIS_AGENT_CAPABILITIES: Capability[] = ['evidence:read', 'work:submit'];
