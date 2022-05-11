import { rest } from 'msw';
import ShortUniqueId from 'short-unique-id';
import { ROUTE_LOGGED } from 'Routes';

import {
  ENDPOINT_GET_TEQ_KEY,
  ENDPOINT_LOGOUT,
  ENDPOINT_PERSONAL_INFO,
} from '../components/utils/Endpoints';
import * as endpoints from '../components/utils/Endpoints';

import {
  EditElectionBody,
  NewElectionBody,
  NewElectionVoteBody,
  NewUserRole,
  RemoveUserRole,
} from '../types/frontendRequestBody';

import { ID } from 'types/configuration';
import { STATUS } from 'types/election';
import { setupMockElection, toLightElectionInfo } from './setupMockElections';
import setupMockUserDB from './setupMockUserDB';
import { ROLE } from 'types/userRole';

const uid = new ShortUniqueId({ length: 8 });
const mockUserID = 561934;

const { mockElections, mockResults } = setupMockElection();

var mockUserDB = setupMockUserDB();

const checkUserRole = (roles: ROLE[]): boolean => {
  const id = sessionStorage.getItem('id');
  const userRole = mockUserDB.find(({ sciper }) => sciper === id).role;

  if (roles.includes(userRole)) {
    return true;
  }
  return false;
};

export const handlers = [
  rest.get(ENDPOINT_PERSONAL_INFO, async (req, res, ctx) => {
    const isLogged = sessionStorage.getItem('is-authenticated') === 'true';
    const userId = isLogged ? mockUserID : 0;
    const userInfos = isLogged
      ? {
          lastname: 'Bobster',
          firstname: 'Alice',
          role: ROLE.Admin,
          sciper: userId,
        }
      : {};
    await new Promise((r) => setTimeout(r, 1000));

    return res(
      ctx.status(200),
      ctx.json({
        islogged: isLogged,
        ...userInfos,
      })
    );
  }),

  rest.get(ENDPOINT_GET_TEQ_KEY, async (req, res, ctx) => {
    const url = ROUTE_LOGGED;
    sessionStorage.setItem('is-authenticated', 'true');
    sessionStorage.setItem('id', mockUserID.toString());

    await new Promise((r) => setTimeout(r, 1000));

    return res(ctx.status(200), ctx.json({ url: url }));
  }),

  rest.post(ENDPOINT_LOGOUT, (req, res, ctx) => {
    sessionStorage.setItem('is-authenticated', 'false');
    return res(ctx.status(200));
  }),

  rest.get(endpoints.elections, async (req, res, ctx) => {
    await new Promise((r) => setTimeout(r, 1000));

    return res(
      ctx.status(200),
      ctx.json({
        Elections: Array.from(mockElections.values()).map((election) =>
          toLightElectionInfo(mockElections, election.ElectionID)
        ),
      })
    );
  }),

  rest.get(endpoints.election(':ElectionID'), async (req, res, ctx) => {
    const { ElectionID } = req.params;
    await new Promise((r) => setTimeout(r, 1000));

    return res(ctx.status(200), ctx.json(mockElections.get(ElectionID as ID)));
  }),

  rest.post(endpoints.newElection, async (req, res, ctx) => {
    const body = req.body as NewElectionBody;

    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin, ROLE.Operator])) {
      return res(
        ctx.status(403),
        ctx.json({ message: 'You are not authorized to create an election' })
      );
    }

    const createElection = (configuration: any) => {
      const newElectionID = uid();

      mockElections.set(newElectionID, {
        ElectionID: newElectionID,
        Status: STATUS.Open,
        Pubkey: 'DEAEV6EMII',
        Result: [],
        Configuration: configuration,
        BallotSize: 290,
        ChunksPerBallot: 10,
      });

      return newElectionID;
    };

    return res(
      ctx.status(200),
      ctx.json({
        ElectionID: createElection(body.Configuration),
      })
    );
  }),

  rest.post(endpoints.newElectionVote(':ElectionID'), async (req, res, ctx) => {
    const { Ballot }: NewElectionVoteBody = req.body as NewElectionVoteBody;
    await new Promise((r) => setTimeout(r, 1000));

    return res(
      ctx.status(200),
      ctx.json({
        Ballot: Ballot,
      })
    );
  }),

  rest.put(endpoints.editElection(':ElectionID'), async (req, res, ctx) => {
    const body = req.body as EditElectionBody;
    const { ElectionID } = req.params;

    let Status = STATUS.Initial;

    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin, ROLE.Operator])) {
      return res(
        ctx.status(403),
        ctx.json({ message: 'You are not authorized to update an election' })
      );
    }

    switch (body.Action) {
      case 'open':
        Status = STATUS.Open;
        break;
      case 'close':
        Status = STATUS.Closed;
        break;
      case 'combineShares':
        Status = STATUS.DecryptedBallots;
        break;
      case 'cancel':
        Status = STATUS.Canceled;
        break;
      default:
        break;
    }
    mockElections.set(ElectionID as string, {
      ...mockElections.get(ElectionID as string),
      Status,
    });

    return res(ctx.status(200), ctx.text('Action successfully done'));
  }),

  rest.put(endpoints.editShuffle(':ElectionID'), async (req, res, ctx) => {
    const { ElectionID } = req.params;

    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin, ROLE.Operator])) {
      return res(
        ctx.status(403),
        ctx.json({ message: 'You are not authorized to update an election' })
      );
    }

    mockElections.set(ElectionID as string, {
      ...mockElections.get(ElectionID as string),
      Status: STATUS.ShuffledBallots,
    });

    return res(ctx.status(200), ctx.text('Action successfully done'));
  }),

  rest.put(endpoints.editDKGActors(':ElectionID'), async (req, res, ctx) => {
    const { ElectionID } = req.params;

    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin, ROLE.Operator])) {
      return res(
        ctx.status(403),
        ctx.json({ message: 'You are not authorized to update an election' })
      );
    }

    mockElections.set(ElectionID as string, {
      ...mockElections.get(ElectionID as string),
      Result: mockResults.get(ElectionID as string),
      Status: STATUS.ResultAvailable,
    });

    return res(ctx.status(200), ctx.text('Action successfully done'));
  }),

  rest.get(endpoints.ENDPOINT_USER_RIGHTS, async (req, res, ctx) => {
    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin])) {
      return res(
        ctx.status(403),
        ctx.json({ message: 'You are not authorized to get users rights' })
      );
    }

    return res(ctx.status(200), ctx.json(mockUserDB.filter((user) => user.role !== 'voter')));
  }),

  rest.post(endpoints.ENDPOINT_ADD_ROLE, async (req, res, ctx) => {
    const body = req.body as NewUserRole;

    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin])) {
      return res(ctx.status(403), ctx.json({ message: 'You are not authorized to add a role' }));
    }

    mockUserDB.push({ id: uid(), ...body });

    return res(ctx.status(200));
  }),

  rest.post(endpoints.ENDPOINT_REMOVE_ROLE, async (req, res, ctx) => {
    const body = req.body as RemoveUserRole;
    await new Promise((r) => setTimeout(r, 1000));

    if (!checkUserRole([ROLE.Admin])) {
      return res(ctx.status(403), ctx.json({ message: 'You are not authorized to remove a role' }));
    }
    mockUserDB = mockUserDB.filter((user) => user.sciper !== body.sciper);

    return res(ctx.status(200));
  }),
];
