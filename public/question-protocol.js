// Shared by the browser and provider adapters; no DOM or account state.
globalThis.ForgeQuestions = {
  isRequest(method) {
    return ['tool/requestUserInput', 'item/tool/requestUserInput', 'anthropic/tool/requestUserInput'].includes(method);
  },
  normalizeClaude(input) {
    return (input.questions || []).map((question, index) => ({
      id: 'claude-question-' + (index + 1),
      header: question.header || 'Question ' + (index + 1),
      question: question.question,
      options: question.options || [],
      multiSelect: Boolean(question.multiSelect),
      isOther: true,
    }));
  },
  validate(questions, answers) {
    if (!Array.isArray(questions) || !questions.length) throw new Error('This question request has no questions.');
    const result = Object.create(null);
    for (const question of questions) {
      const values = answers?.[question.id]?.answers;
      if (!Array.isArray(values) || !values.length || values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 10000)) {
        throw new Error('Answer each question before continuing.');
      }
      if (!question.multiSelect && values.length !== 1) throw new Error('Select one answer for ' + question.question);
      const options = question.options || [];
      if (options.length && !question.isOther && values.some((value) => !options.some((option) => option.label === value))) {
        throw new Error('Choose one of the offered answers.');
      }
      result[question.id] = { answers: [...new Set(values)] };
    }
    return result;
  },
  fromDraft(questions, drafts = {}) {
    const answers = Object.create(null);
    for (const question of questions) {
      const draft = drafts[question.id] || {};
      const selected = draft.selected || [];
      const custom = draft.custom?.trim();
      answers[question.id] = { answers: draft.useCustom ? [...(question.multiSelect ? selected : []), ...(custom ? [custom] : [])] : selected };
    }
    return this.validate(questions, answers);
  },
  claudeInput(input, questions, answers) {
    const validated = this.validate(questions, answers);
    const mapped = Object.create(null);
    questions.forEach((question, index) => { mapped[input.questions[index].question] = validated[question.id].answers.join(', '); });
    return { ...input, answers: mapped };
  },
};
