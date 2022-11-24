import { FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Answers, SelectQuestion } from 'types/configuration';
import { answersFrom } from 'types/getObjectType';
import { default as i18n } from 'i18next';
type SelectProps = {
  select: SelectQuestion;
  answers: Answers;
  setAnswers: (answers: Answers) => void;
  language: string;
};

const Select: FC<SelectProps> = ({ select, answers, setAnswers, language }) => {
  const { t } = useTranslation();

  const handleChecks = (e: React.ChangeEvent<HTMLInputElement>, choiceIndex: number) => {
    const newAnswers = answersFrom(answers);
    let selectAnswers = newAnswers.SelectAnswers.get(select.ID);

    if (select.MaxN === 1) {
      selectAnswers = new Array<boolean>(select.Choices.length).fill(false);
    }

    selectAnswers[choiceIndex] = e.target.checked;
    newAnswers.SelectAnswers.set(select.ID, selectAnswers);
    const numAnswer = selectAnswers.filter((check: boolean) => check === true).length;

    if (numAnswer >= select.MinN && numAnswer < select.MaxN + 1) {
      newAnswers.Errors.set(select.ID, '');
    } else if (numAnswer >= select.MaxN + 1) {
      newAnswers.Errors.set(select.ID, t('maxSelectError', { max: select.MaxN }));
    }

    setAnswers(newAnswers);
  };

  const hintDisplay = () => {
    let hint = '';
    const max = select.MaxN;
    const min = select.MinN;

    if (max === min) {
      hint =
        max > 1
          ? t('selectMin', { minSelect: min, singularPlural: t('pluralAnswers') })
          : t('selectMin', { minSelect: min, singularPlural: t('singularAnswer') });
    } else if (min === 0) {
      hint =
        max > 1
          ? t('selectMax', { maxSelect: max, singularPlural: t('pluralAnswers') })
          : t('selectMax', { maxSelect: max, singularPlural: t('singularAnswer') });
    } else {
      hint = t('selectBetween', { minSelect: min, maxSelect: max });
    }

    return <div className="text-sm pl-2 pb-2 sm:pl-4 text-gray-400">{hint}</div>;
  };
  const [titles, setTitles] = useState<any>({});
  useEffect(() => {
    try {
      const ts = JSON.parse(select.Title);
      setTitles(ts);
    } catch (e) {
      console.log('error', e);
    }
  }, [select]);
  const choiceDisplay = (isChecked: boolean, choice: string, choiceIndex: number) => {
    return (
      <div key={choice}>
        <input
          id={choice}
          className="h-4 w-4 mt-1 mr-2 cursor-pointer accent-indigo-500"
          type="checkbox"
          value={choice}
          checked={isChecked}
          onChange={(e) => handleChecks(e, choiceIndex)}
        />
        <label htmlFor={choice} className="pl-2 break-words text-gray-600 cursor-pointer">
          {choice}
        </label>
      </div>
    );
  };

  return (
    <div>
      <h3 className="text-lg break-words text-gray-600">
        {language == 'en' && select.Title}
        {language == 'fr' && select.TitleFr}
        {language == 'de' && select.TitleDe}</h3>
      {hintDisplay()}
      <div className="sm:pl-8 pl-6">
        {Array.from(answers.SelectAnswers.get(select.ID).entries()).map(
          ([choiceIndex, isChecked]) =>{
            if(language == 'en' )
                return choiceDisplay(isChecked, select.Choices[choiceIndex], choiceIndex)
            else if(language == 'fr')
                return choiceDisplay(isChecked, select.ChoicesFr[choiceIndex], choiceIndex)
            else if(language == 'de') 
                return choiceDisplay(isChecked, select.ChoicesDe[choiceIndex], choiceIndex)
          }
         
        )}
      </div>
      <div className="text-red-600 text-sm py-2 sm:pl-4 pl-2">{answers.Errors.get(select.ID)}</div>
    </div>
  );
};

export default Select;
