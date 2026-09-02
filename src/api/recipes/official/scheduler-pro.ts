export const schedulerProRecipePackage = {
  packageKey: 'scheduler-pro',
  name: 'Scheduler Pro',
  description: 'Receitas oficiais para consulta, confirmação, cancelamento e reagendamento de agendamentos.',
  version: 1,
  credentialRef: 'SCHEDULER_PRO',
  actions: [
    {
      actionKey: 'scheduler.appointment.get',
      name: 'Consultar agendamento',
      description: 'Consulta um agendamento no Scheduler Pro.',
      method: 'GET',
      path: '/appointments/{{input.appointmentId}}',
      inputSchema: {
        type: 'object',
        properties: { appointmentId: { type: 'string', minLength: 1 } },
        required: ['appointmentId'],
      },
      confirmation: 'NONE',
    },
    {
      actionKey: 'scheduler.appointment.confirm',
      name: 'Confirmar agendamento',
      description: 'Confirma um agendamento pela Central de Check-in do Scheduler Pro.',
      method: 'POST',
      path: '/check-in/{{input.appointmentId}}/confirm',
      inputSchema: {
        type: 'object',
        properties: { appointmentId: { type: 'string', minLength: 1 } },
        required: ['appointmentId'],
      },
      confirmation: 'CONFIRM',
    },
    {
      actionKey: 'scheduler.appointment.cancel',
      name: 'Cancelar agendamento',
      description: 'Cancela um agendamento usando a rota de status do Scheduler Pro.',
      method: 'PATCH',
      path: '/appointments/{{input.appointmentId}}/status',
      requestTemplate: {
        body: {
          status: 'CANCELLED',
          reason: '{{input.reason}}',
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          appointmentId: { type: 'string', minLength: 1 },
          reason: { type: 'string' },
        },
        required: ['appointmentId'],
      },
      confirmation: 'CONFIRM',
    },
    {
      actionKey: 'scheduler.appointment.reschedule',
      name: 'Reagendar atendimento',
      description: 'Reagenda um atendimento para um intervalo previamente selecionado.',
      method: 'POST',
      path: '/appointments/{{input.appointmentId}}/reschedule',
      requestTemplate: {
        body: {
          starts_at: '{{input.startsAt}}',
          ends_at: '{{input.endsAt}}',
          professional_id: '{{input.professionalId}}',
          reason: '{{input.reason}}',
        },
      },
      inputSchema: {
        type: 'object',
        properties: {
          appointmentId: { type: 'string', minLength: 1 },
          startsAt: { type: 'string', minLength: 1 },
          endsAt: { type: 'string', minLength: 1 },
          professionalId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['appointmentId', 'startsAt', 'endsAt'],
      },
      confirmation: 'CONFIRM',
    },
    {
      actionKey: 'scheduler.availability.find',
      name: 'Consultar disponibilidade',
      description: 'Consulta disponibilidade no Scheduler Pro usando os parâmetros fornecidos.',
      method: 'GET',
      path: '/availability',
      requestTemplate: { query: '{{input}}' },
      confirmation: 'NONE',
    },
  ],
  recipes: [
    {
      recipeKey: 'scheduler.appointment.details',
      name: 'Consultar detalhes do agendamento',
      description: 'Consulta os dados atuais de um agendamento.',
      version: 1,
      confirmation: 'NONE',
      steps: [
        { id: 'appointment', action: 'scheduler.appointment.get', input: { appointmentId: '{{input.appointmentId}}' } },
      ],
      outputTemplate: { appointment: '{{steps.appointment.result.data}}' },
    },
    {
      recipeKey: 'scheduler.appointment.confirm',
      name: 'Confirmar agendamento',
      description: 'Confirma o agendamento explicitamente escolhido pelo cliente.',
      version: 1,
      confirmation: 'CONFIRM',
      steps: [
        { id: 'confirm', action: 'scheduler.appointment.confirm', input: { appointmentId: '{{input.appointmentId}}' } },
      ],
      outputTemplate: { result: '{{steps.confirm.result.data}}' },
    },
    {
      recipeKey: 'scheduler.appointment.cancel',
      name: 'Cancelar agendamento',
      description: 'Cancela o agendamento explicitamente escolhido pelo cliente.',
      version: 1,
      confirmation: 'CONFIRM',
      steps: [
        {
          id: 'cancel',
          action: 'scheduler.appointment.cancel',
          input: { appointmentId: '{{input.appointmentId}}', reason: '{{input.reason}}' },
        },
      ],
      outputTemplate: { result: '{{steps.cancel.result.data}}' },
    },
    {
      recipeKey: 'scheduler.appointment.reschedule',
      name: 'Reagendar agendamento',
      description: 'Aplica o novo intervalo previamente escolhido pelo cliente ou operador.',
      version: 1,
      confirmation: 'CONFIRM',
      steps: [
        {
          id: 'reschedule',
          action: 'scheduler.appointment.reschedule',
          input: {
            appointmentId: '{{input.appointmentId}}',
            startsAt: '{{input.startsAt}}',
            endsAt: '{{input.endsAt}}',
            professionalId: '{{input.professionalId}}',
            reason: '{{input.reason}}',
          },
        },
      ],
      outputTemplate: { result: '{{steps.reschedule.result.data}}' },
    },
  ],
  templates: [
    {
      name: 'scheduler_appointment_confirmation',
      language: 'pt_BR',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'Olá {{customer.name}}, seu atendimento está agendado para {{appointment.date}} às {{appointment.time}} com {{appointment.professional}}. Deseja confirmar?',
        },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
            { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
          ],
        },
      ],
      actions: {
        bindings: [
          {
            id: 'confirm',
            matchTitle: 'Confirmar',
            type: 'RECIPE',
            key: 'scheduler.appointment.confirm',
            confirmOnInteraction: true,
            input: { appointmentId: '{{session.variables.appointmentId}}' },
            response: { type: 'TEXT', text: '✅ Agendamento confirmado com sucesso.' },
            onError: { type: 'TEXT', text: 'Não foi possível confirmar o agendamento agora.' },
          },
          {
            id: 'cancel',
            matchTitle: 'Cancelar',
            type: 'RECIPE',
            key: 'scheduler.appointment.cancel',
            confirmOnInteraction: true,
            input: {
              appointmentId: '{{session.variables.appointmentId}}',
              reason: 'Cancelado pelo cliente via WhatsApp',
            },
            response: { type: 'TEXT', text: 'Agendamento cancelado. O horário foi liberado.' },
            onError: { type: 'TEXT', text: 'Não foi possível cancelar o agendamento agora.' },
          },
        ],
      },
      policy: { interactionTtlSeconds: 86400 },
    },
  ],
} as const;
