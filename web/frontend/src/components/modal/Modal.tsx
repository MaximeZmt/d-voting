import React, { Fragment } from 'react';
import PropTypes from 'prop-types';

import { Dialog, Transition } from '@headlessui/react';

const Modal = ({ showModal, setShowModal, textModal, buttonRightText, onClose }) => {
  const closeModal = () => {
    setShowModal(false);
    if (onClose !== undefined) {
      onClose();
    }
  };

  return (
    <div>
      {showModal ? (
        <Transition appear show={showModal} as={Fragment}>
          <Dialog as="div" className="fixed inset-0 z-10 overflow-y-auto " onClose={closeModal}>
            <div className="min-h-screen px-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100"
                leaveTo="opacity-0">
                <Dialog.Overlay className="fixed inset-0" />
              </Transition.Child>

              {/* This element is to trick the browser into centering the modal contents. */}
              <span className="inline-block h-screen align-middle" aria-hidden="true">
                &#8203;
              </span>
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95">
                <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all bg-slate-50 transform bg-white shadow-xl rounded-2xl">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                    Notification
                  </Dialog.Title>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500 break-words">{textModal}</p>
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      className="inline-flex justify-center px-4 py-2 text-sm font-medium text-blue-900 bg-blue-100 border border-transparent rounded-md hover:bg-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
                      onClick={closeModal}>
                      {buttonRightText}
                    </button>
                  </div>
                </div>
              </Transition.Child>
            </div>
          </Dialog>
        </Transition>
      ) : null}
    </div>
  );
};

Modal.propTypes = {
  showModal: PropTypes.bool.isRequired,
  setShowModal: PropTypes.func.isRequired,
  textModal: PropTypes.string.isRequired,
  buttonRightText: PropTypes.string.isRequired,
  onClose: PropTypes.func,
};

export default Modal;
