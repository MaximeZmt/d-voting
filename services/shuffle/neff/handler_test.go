package neff

import (
	"bytes"
	"context"
	"encoding/hex"
	"io"
	"strconv"
	"testing"

	"github.com/dedis/d-voting/services/shuffle/neff/types"
	"go.dedis.ch/kyber/v3"

	etypes "github.com/dedis/d-voting/contracts/evoting/types"
	"github.com/dedis/d-voting/internal/testing/fake"
	"github.com/stretchr/testify/require"
	"go.dedis.ch/dela/core/access"
	"go.dedis.ch/dela/core/ordering"
	"go.dedis.ch/dela/core/ordering/cosipbft/authority"
	"go.dedis.ch/dela/core/ordering/cosipbft/blockstore"
	orderingTypes "go.dedis.ch/dela/core/ordering/cosipbft/types"
	"go.dedis.ch/dela/core/store"
	"go.dedis.ch/dela/core/txn"
	"go.dedis.ch/dela/core/txn/pool"
	"go.dedis.ch/dela/core/txn/signed"
	"go.dedis.ch/dela/core/validation"
	"go.dedis.ch/dela/crypto"
	"go.dedis.ch/dela/mino"
	"go.dedis.ch/dela/serde"
	"go.dedis.ch/kyber/v3/util/random"
	"golang.org/x/xerrors"
)

func TestHandler_Stream(t *testing.T) {
	handler := Handler{}
	receiver := fake.NewBadReceiver()
	err := handler.Stream(fake.Sender{}, receiver)
	require.EqualError(t, err, fake.Err("failed to receive"))

	receiver = fake.NewReceiver(
		fake.NewRecvMsg(fake.NewAddress(0), fake.Message{}),
	)
	err = handler.Stream(fake.Sender{}, receiver)
	require.EqualError(t, err, "expected StartShuffle message, got: fake.Message")

	receiver = fake.NewReceiver(fake.NewRecvMsg(fake.NewAddress(0),
		types.NewStartShuffle("dummyID", make([]mino.Address, 0))))

	err = handler.Stream(fake.Sender{}, receiver)
	require.EqualError(t, err, "failed to handle StartShuffle message: failed "+
		"to get election: failed to decode electionIDHex: encoding/hex: invalid byte: U+0075 'u'")

	//Test successful Shuffle round from message:
	dummyID := hex.EncodeToString([]byte("dummyId"))
	handler = initValidHandler(dummyID)

	receiver = fake.NewReceiver(fake.NewRecvMsg(fake.NewAddress(0), types.NewStartShuffle(dummyID, make([]mino.Address, 0))))
	err = handler.Stream(fake.Sender{}, receiver)

	require.NoError(t, err)

}

func TestHandler_StartShuffle(t *testing.T) {
	// Some initialization:
	k := 3

	Ks, Cs, pubKey := fakeKCPoints(k)

	fakeErr := xerrors.Errorf("fake error")

	handler := Handler{
		me: fake.NewAddress(0),
	}
	dummyID := hex.EncodeToString([]byte("dummyId"))

	// Service not working:
	badService := FakeService{
		err:        fakeErr,
		election:   nil,
		electionID: etypes.ID(dummyID),
	}
	handler.service = &badService

	err := handler.handleStartShuffle(dummyID)
	require.EqualError(t, err, "failed to get election: failed to get proof: fake error")

	// Election does not exist
	service := FakeService{
		err:        nil,
		election:   nil,
		electionID: etypes.ID(dummyID),
		context:    serdecontext,
	}
	handler.service = &service

	err = handler.handleStartShuffle(dummyID)
	require.EqualError(t, err, "failed to get election: election does not exist")

	// Election still opened:
	election := etypes.Election{
		ElectionID:       dummyID,
		AdminID:          "dummyAdminID",
		Status:           0,
		Pubkey:           nil,
		Suffragia:        etypes.Suffragia{},
		ShuffleInstances: []etypes.ShuffleInstance{},
		DecryptedBallots: nil,
		ShuffleThreshold: 1,
		BallotSize:       1,
	}

	service = updateService(election, dummyID)
	handler.service = &service
	handler.context = serdecontext

	err = handler.handleStartShuffle(dummyID)
	require.EqualError(t, err, "the election must be closed: but status is 0")

	// Wrong formatted ballots:
	election.Status = etypes.Closed

	deleteUserFromSuffragia := func(suff *etypes.Suffragia, userID string) bool {
		for i, u := range suff.UserIDs {
			if u == userID {
				suff.UserIDs = append(suff.UserIDs[:i], suff.UserIDs[i+1:]...)
				suff.Ciphervotes = append(suff.Ciphervotes[:i], suff.Ciphervotes[i+1:]...)
				return true
			}
		}

		return false
	}

	deleteUserFromSuffragia(&election.Suffragia, "fakeUser")

	// Valid Ballots, bad election.PubKey
	for i := 0; i < k; i++ {
		ballot := etypes.Ciphervote{etypes.EGPair{
			K: Ks[i],
			C: Cs[i],
		},
		}
		election.Suffragia.CastVote("dummyUser"+strconv.Itoa(i), ballot)
	}

	service = updateService(election, dummyID)

	handler.service = &service

	// Wrong shuffle signer
	election.Pubkey = pubKey

	service = updateService(election, dummyID)
	handler.service = &service

	handler.shuffleSigner = fake.NewBadSigner()

	err = handler.handleStartShuffle(dummyID)
	require.EqualError(t, err, fake.Err("failed to make tx: could not sign the shuffle "))

	// Bad common signer :
	service = updateService(election, dummyID)

	handler.service = &service
	handler.shuffleSigner = fake.NewSigner()

	// Bad manager

	handler.txmngr = fakeManager{}

	err = handler.handleStartShuffle(dummyID)
	require.EqualError(t, err, fake.Err("failed to make tx: failed to use manager"))

	manager := signed.NewManager(fake.NewSigner(), fakeClient{})

	handler.txmngr = manager

	// Bad pool :

	service = updateService(election, dummyID)
	badPool := FakePool{err: fakeErr,
		service: &service}
	handler.p = &badPool
	handler.service = &service

	err = handler.handleStartShuffle(dummyID)
	require.EqualError(t, err, "failed to add transaction to the pool: fake error")

	// Valid, basic scenario : (all errors fixed)
	fakePool := FakePool{service: &service}

	handler.service = &service
	handler.p = &fakePool

	err = handler.handleStartShuffle(dummyID)
	require.NoError(t, err)

	// Threshold is reached :
	election.ShuffleThreshold = 0
	service = updateService(election, dummyID)
	fakePool = FakePool{service: &service}
	handler.service = &service

	err = handler.handleStartShuffle(dummyID)
	require.NoError(t, err)

	// Service not working :
	election.ShuffleThreshold = 1
	service = FakeService{
		err:        nil,
		election:   &election,
		electionID: etypes.ID(dummyID),
		status:     true,
		context:    serdecontext,
	}
	fakePool = FakePool{service: &service}
	service.status = false
	handler.service = &service
	err = handler.handleStartShuffle(dummyID)
	// all transactions got denied
	require.NoError(t, err)

	// Shuffle already started:
	shuffledBallots := append([]etypes.Ciphervote{}, election.Suffragia.Ciphervotes...)
	election.ShuffleInstances = append(election.ShuffleInstances, etypes.ShuffleInstance{ShuffledBallots: shuffledBallots})

	election.ShuffleThreshold = 2

	service = updateService(election, dummyID)
	fakePool = FakePool{service: &service}
	handler = *NewHandler(handler.me, &service, &fakePool, manager, handler.shuffleSigner, serdecontext)

	err = handler.handleStartShuffle(dummyID)
	require.NoError(t, err)
}

// -----------------------------------------------------------------------------
// Utility functions
func updateService(election etypes.Election, dummyID string) FakeService {
	return FakeService{
		err:        nil,
		election:   &election,
		electionID: etypes.ID(dummyID),
		context:    serdecontext,
	}
}

func initValidHandler(dummyID string) Handler {
	handler := Handler{}

	election := initFakeElection(dummyID)

	service := FakeService{
		err:        nil,
		election:   &election,
		electionID: etypes.ID(dummyID),
		status:     true,
		context:    serdecontext,
	}
	fakePool := FakePool{service: &service}

	handler.service = &service
	handler.p = &fakePool
	handler.me = fake.NewAddress(0)
	handler.shuffleSigner = fake.NewSigner()
	handler.txmngr = signed.NewManager(fake.NewSigner(), fakeClient{})
	handler.context = serdecontext

	return handler
}

func initFakeElection(electionID string) etypes.Election {
	k := 3
	KsMarshalled, CsMarshalled, pubKey := fakeKCPoints(k)
	election := etypes.Election{
		ElectionID:       electionID,
		AdminID:          "dummyAdminID",
		Status:           etypes.Closed,
		Pubkey:           pubKey,
		Suffragia:        etypes.Suffragia{},
		ShuffleInstances: []etypes.ShuffleInstance{},
		DecryptedBallots: nil,
		ShuffleThreshold: 1,
		BallotSize:       1,
	}

	for i := 0; i < k; i++ {
		ballot := etypes.Ciphervote{etypes.EGPair{
			K: KsMarshalled[i],
			C: CsMarshalled[i],
		},
		}
		election.Suffragia.CastVote("dummyUser"+strconv.Itoa(i), ballot)
	}
	return election
}

func fakeKCPoints(k int) ([]kyber.Point, []kyber.Point, kyber.Point) {
	RandomStream := suite.RandomStream()
	h := suite.Scalar().Pick(RandomStream)
	pubKey := suite.Point().Mul(h, nil)

	Ks := make([]kyber.Point, 0, k)
	Cs := make([]kyber.Point, 0, k)

	for i := 0; i < k; i++ {
		// Embed the message into a curve point
		message := "Ballot" + strconv.Itoa(i)
		M := suite.Point().Embed([]byte(message), random.New())

		// ElGamal-encrypt the point to produce ciphertext (K,C).
		k := suite.Scalar().Pick(random.New()) // ephemeral private key
		K := suite.Point().Mul(k, nil)         // ephemeral DH public key
		S := suite.Point().Mul(k, pubKey)      // ephemeral DH shared secret
		C := S.Add(S, M)                       // message blinded with secret

		Ks = append(Ks, K)
		Cs = append(Cs, C)
	}
	return Ks, Cs, pubKey
}

// FakeProof
// - implements ordering.Proof
type FakeProof struct {
	key   []byte
	value []byte
}

// GetKey implements ordering.Proof. It returns the key associated to the proof.
func (f FakeProof) GetKey() []byte {
	return f.key
}

// GetValue implements ordering.Proof. It returns the value associated to the
// proof if the key exists, otherwise it returns nil.
func (f FakeProof) GetValue() []byte {
	return f.value
}

//
// Fake Service
//

type FakeService struct {
	err        error
	election   *etypes.Election
	electionID etypes.ID
	status     bool
	channel    chan ordering.Event
	context    serde.Context
}

func (f FakeService) GetProof(key []byte) (ordering.Proof, error) {
	electionIDBuff, _ := hex.DecodeString(string(f.electionID))

	if bytes.Equal(key, electionIDBuff) {
		if f.election == nil {
			return nil, f.err
		}

		electionBuff, err := f.election.Serialize(f.context)
		if err != nil {
			return nil, xerrors.Errorf("failed to serialize election: %v", err)
		}

		proof := FakeProof{
			key:   key,
			value: electionBuff,
		}
		return proof, f.err
	}

	return nil, f.err
}

func (f FakeService) GetStore() store.Readable {
	return nil
}

func (f *FakeService) AddTx(tx FakeTransaction) {
	results := make([]validation.TransactionResult, 3)

	results[0] = FakeTransactionResult{
		status:      true,
		message:     "",
		transaction: FakeTransaction{nonce: 10, id: []byte("dummyId1")},
	}

	results[1] = FakeTransactionResult{
		status:      true,
		message:     "",
		transaction: FakeTransaction{nonce: 11, id: []byte("dummyId2")},
	}

	results[2] = FakeTransactionResult{
		status:      f.status,
		message:     "",
		transaction: tx,
	}

	f.status = true

	f.channel <- ordering.Event{
		Index:        0,
		Transactions: results,
	}
	close(f.channel)

}

func (f *FakeService) Watch(ctx context.Context) <-chan ordering.Event {
	f.channel = make(chan ordering.Event, 100)
	return f.channel
}

func (f FakeService) Close() error {
	return f.err
}

//
// Fake Pool
//

type FakePool struct {
	err         error
	transaction FakeTransaction
	service     *FakeService
}

func (f FakePool) SetPlayers(players mino.Players) error {
	return nil
}

func (f FakePool) AddFilter(filter pool.Filter) {
}

func (f FakePool) Len() int {
	return 0
}

func (f *FakePool) Add(transaction txn.Transaction) error {
	newTx := FakeTransaction{
		nonce: transaction.GetNonce(),
		id:    transaction.GetID(),
	}

	f.transaction = newTx
	f.service.AddTx(newTx)

	return f.err
}

func (f FakePool) Remove(transaction txn.Transaction) error {
	return nil
}

func (f FakePool) Gather(ctx context.Context, config pool.Config) []txn.Transaction {
	return nil
}

func (f FakePool) Close() error {
	return nil
}

//
// Fake Transaction
//

type FakeTransaction struct {
	nonce uint64
	id    []byte
}

func (f FakeTransaction) Serialize(ctx serde.Context) ([]byte, error) {
	return nil, nil
}

func (f FakeTransaction) Fingerprint(writer io.Writer) error {
	return nil
}

func (f FakeTransaction) GetID() []byte {
	return f.id
}

func (f FakeTransaction) GetNonce() uint64 {
	return f.nonce
}

func (f FakeTransaction) GetIdentity() access.Identity {
	return nil
}

func (f FakeTransaction) GetArg(key string) []byte {
	return nil
}

//
// Fake TransactionResult
//

type FakeTransactionResult struct {
	status      bool
	message     string
	transaction FakeTransaction
}

func (f FakeTransactionResult) Serialize(ctx serde.Context) ([]byte, error) {
	return nil, nil
}

func (f FakeTransactionResult) GetTransaction() txn.Transaction {
	return f.transaction
}

func (f FakeTransactionResult) GetStatus() (bool, string) {
	return f.status, f.message
}

//
// Fake Result
//

type FakeResult struct {
}

func (f FakeResult) Serialize(ctx serde.Context) ([]byte, error) {
	return nil, nil
}

func (f FakeResult) Fingerprint(writer io.Writer) error {
	return nil
}

func (f FakeResult) GetTransactionResults() []validation.TransactionResult {
	results := make([]validation.TransactionResult, 1)

	results[0] = FakeTransactionResult{
		status:      true,
		message:     "",
		transaction: FakeTransaction{nonce: 10},
	}

	return results
}

//
// Fake BlockLink
//

type FakeBlockLink struct {
}

func (f FakeBlockLink) Serialize(ctx serde.Context) ([]byte, error) {
	return nil, nil
}

func (f FakeBlockLink) Fingerprint(writer io.Writer) error {
	return nil
}

func (f FakeBlockLink) GetHash() orderingTypes.Digest {
	return orderingTypes.Digest{}
}

func (f FakeBlockLink) GetFrom() orderingTypes.Digest {
	return orderingTypes.Digest{}
}

func (f FakeBlockLink) GetTo() orderingTypes.Digest {
	return orderingTypes.Digest{}
}

func (f FakeBlockLink) GetPrepareSignature() crypto.Signature {
	return nil
}

func (f FakeBlockLink) GetCommitSignature() crypto.Signature {
	return nil
}

func (f FakeBlockLink) GetChangeSet() authority.ChangeSet {
	return nil
}

func (f FakeBlockLink) GetBlock() orderingTypes.Block {

	result := FakeResult{}

	block, _ := orderingTypes.NewBlock(result)
	return block
}

func (f FakeBlockLink) Reduce() orderingTypes.Link {
	return nil
}

//
// Fake BlockStore
//

type FakeBlockStore struct {
	getErr  error
	lastErr error
}

func (f FakeBlockStore) Len() uint64 {
	return 0
}

func (f FakeBlockStore) Store(link orderingTypes.BlockLink) error {
	return nil
}

func (f FakeBlockStore) Get(id orderingTypes.Digest) (orderingTypes.BlockLink, error) {
	return FakeBlockLink{}, f.getErr
}

func (f FakeBlockStore) GetByIndex(index uint64) (orderingTypes.BlockLink, error) {
	return nil, nil
}

func (f FakeBlockStore) GetChain() (orderingTypes.Chain, error) {
	return nil, nil
}

func (f FakeBlockStore) Last() (orderingTypes.BlockLink, error) {
	return FakeBlockLink{}, f.lastErr
}

func (f FakeBlockStore) Watch(ctx context.Context) <-chan orderingTypes.BlockLink {
	return nil
}

func (f FakeBlockStore) WithTx(transaction store.Transaction) blockstore.BlockStore {
	return nil
}

type fakeClient struct{}

func (fakeClient) GetNonce(access.Identity) (uint64, error) {
	return 0, nil
}
