import { EyeOffIcon } from '@heroicons/react/outline';
import { AuthContext } from 'index';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { OngoingAction, Status } from 'types/form';
import { UserRole } from 'types/userRole';
import ActionButton from './ActionButton';

function hasAuthorization(authCtx, subject: string, action: string): boolean {
  return (
    authCtx.authorization.has(subject) && authCtx.authorization.get(subject).indexOf(action) !== -1
  );
}

const ShuffleButton = ({ status, handleShuffle, ongoingAction }) => {
  const authCtx = useContext(AuthContext);
  const { t } = useTranslation();

  //const isAuthorized = authCtx.role === UserRole.Admin || authCtx.role === UserRole.Operator;

  return (
    hasAuthorization(authCtx, 'election', 'create') &&
    status === Status.Closed && (
      <ActionButton
        handleClick={handleShuffle}
        ongoing={ongoingAction === OngoingAction.Shuffling}
        ongoingText={t('shuffling')}>
        <>
          <EyeOffIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
          {t('shuffle')}
        </>
      </ActionButton>
    )
  );
};

export default ShuffleButton;
