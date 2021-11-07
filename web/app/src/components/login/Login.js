import {React, useContext, useState} from 'react';
import {Translations} from '../language/Translations';
import {LanguageContext} from '../language/LanguageContext';
import {SIGNIN_ENDPOINT} from '../utils/Endpoints';
import {GET_TEQ_EENDPOINT} from '../utils/ExpressEndoints';
import './Login.css';
import PropTypes from 'prop-types';


const Login = ({setToken}) => {
    const request = null;
    const [loginError, setLoginError] = useState();
    const [context, ] = useContext(LanguageContext);

    const handleClick = async() => {
        /*try{
            const response = await fetch(SIGNIN_ENDPOINT,request);        
            if(!response.ok){
                throw Error(response.statusText);
            } else {
                let loginData = await response.json();
                setToken(loginData.Token);
                sessionStorage.setItem('id', loginData.UserID);
                setLoginError();
            }
        } catch(error){
            setLoginError(error);
            console.log(error);
        }*/


        try{
            fetch(GET_TEQ_EENDPOINT).then(resp => {
                console.log(resp);
                const json_data = resp.json();
                json_data.then(result => {
                    window.location = result['url'];
                });

                //window.location = resp_json['url'];

            }).catch(error => {
                console.log(error);
            });

        } catch (error){
            console.log(error);
        }




        return (<div>
            {loginError === null? <div></div>: Translations[context].errorServerDown}
        </div>)
    }

    return (
        <div className='login-wrapper'>
            <div className='login-txt'>{Translations[context].loginText}</div>
            <button id='login-button' className='login-btn' onClick={handleClick}>{Translations[context].login}</button>
        </div>
    )
}

Login.propTypes = {
    setToken : PropTypes.func,
}

export default Login;