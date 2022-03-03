import useFetchCall from './useFetchCall';
import useFillElectionFields from './useFillElectionFields';
import { ENDPOINT_EVOTING_GET_ELECTION } from './Endpoints';

/* custom hook that fetches an election given its id and
returns its different parameters*/
const useElection = (electionID, token) => {
  const request = {
    method: 'POST',
    body: JSON.stringify({ ElectionID: electionID, Token: token }),
  };
  const [data, loading, error] = useFetchCall(ENDPOINT_EVOTING_GET_ELECTION, request);
  const {
    title,
    candidates,
    status,
    pubKey,
    result,
    setResult,
    setStatus,
    isResultSet,
    setIsResultSet,
  } = useFillElectionFields(data);
  return {
    loading,
    title,
    candidates,
    electionID,
    status,
    pubKey,
    result,
    setResult,
    setStatus,
    isResultSet,
    setIsResultSet,
    error,
  };
};

export default useElection;